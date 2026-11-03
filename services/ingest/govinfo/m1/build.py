"""Build the module-1 contract (see ../contract-spec.md) from cached sources. No model calls.

Outputs in out/: records.jsonl, person_bill.jsonl, bill_domain.jsonl, bills.jsonl, sources.jsonl,
domains.jsonl, person_committee.jsonl, persons.jsonl, sft.jsonl, splits.json, text/<pkg>.txt, pilot_report.md
"""
import hashlib
import json
import pathlib
import re
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict

from m1 import fetch, parse, roster

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / 'cache'
OUT = ROOT / 'out'
GOVINFO = 'https://www.govinfo.gov'

LINKAGE = {'sponsored': 'super_high', 'cosponsored': 'high', 'committee_vote': 'high', 'floor_vote': 'high',
           'signed_views': 'high', 'offered_amendment': 'mid', 'spoke': 'mid', 'mentioned': 'low'}
VIEWS_STANCE = {'minority_views': 'against', 'dissenting_views': 'against', 'additional_views': 'unknown',
                'supplemental_views': 'unknown', 'views': 'unknown'}
# H. Rept. 119-59 is the Oversight Committee's compilation of every committee's oversight plan; its 'minority views'
# are embedded letters and the signature parser picks up the next chairman's name (Muse pilot, Oct 29).
SKIP_PKGS = {'CRPT-119hrpt59': 'oversight-plans compilation: views are other committees\' letters, signatures unreliable'}
VOTE_STANCE = {'yea': 'for', 'nay': 'against', 'present': 'neutral', 'not_voting': 'neutral'}

# What a roll call decided, from the printed question (deterministic; the web weighs votes by it, owl #25/#26/#29).
_AMEND_EXPLICIT_RE = re.compile(r'vote on (?:the |an |a )?amendment|amendments? (?:offered|by|no\.|numbered)|\bamdt\b|\bLog \d|^(?:No\. )?\d{2,3}\b,?|'
                                r'^On [A-Z][a-z]+ Log', re.I)
_FINAL_RE = re.compile(r'ordered (?:to be )?(?:favorably |adversely |unfavorably )?reported|motion to report|final passage|favorably report|'
                       r'reported favorably|be reported to the (?:full committee|house)|forward(?:ed)? to the (?:full )?committee|'
                       r'report(?:ing)? the (?:bill|resolution|measure)|adopt(?:ed|ion of)? the (?:bill|resolution|measure)', re.I)
_AMEND_RE = re.compile(r'\bamendment|\bsubstitute\b|\ben bloc\b', re.I)
_PROC_RE = re.compile(r'motion to (?:table|recommit|adjourn|postpone|strike|close|proceed|instruct|reconsider|rise|limit|waive|recess)|'
                      r'previous question|point of order|appeal|quorum|subpoena|resolution of inquiry', re.I)


def classify_question(q):
    """-> final_passage | amendment | procedural | unknown"""
    if not q:
        return 'unknown'
    if _AMEND_EXPLICIT_RE.search(q):
        return 'amendment'
    if _FINAL_RE.search(q):
        return 'final_passage'
    if _AMEND_RE.search(q):
        return 'amendment'
    if _PROC_RE.search(q):
        return 'procedural'
    return 'unknown'
RECORD_TYPES = {'purpose', 'legislative_history', 'committee_votes'} | parse.VIEWS_TYPES
MAX_CHUNK_CHARS = 12000           # ~3k tokens; long views sections are split at paragraph boundaries
MAX_PURPOSE_CHARS = 6000          # the purpose/summary section is context only
BILL_LABEL = {'hr': 'H.R.', 'hres': 'H. Res.', 'hjres': 'H.J. Res.', 'hconres': 'H. Con. Res.',
              's': 'S.', 'sres': 'S. Res.', 'sjres': 'S.J. Res.', 'sconres': 'S. Con. Res.'}
BILL_SLUG = {'hr': 'house-bill', 'hres': 'house-resolution', 'hjres': 'house-joint-resolution',
             'hconres': 'house-concurrent-resolution', 's': 'senate-bill', 'sres': 'senate-resolution',
             'sjres': 'senate-joint-resolution', 'sconres': 'senate-concurrent-resolution'}
NOT_IN_GRAPH = {'HSRU', 'HSSO', 'HSHA'}
SYSTEM_PROMPT = ('You extract legislator-bill actions from US House documents. Answer with a JSON array of rows '
                 '{person_id, bill_id, action, vote, vote_question, views_type, stance}. Use bioguide ids from the '
                 '[MEMBERS] line; never invent a person. Quote verbatim when asked for a quote.')


def citation(pkg):
    m = re.search(r'hrpt(\d+)(?:-pt(\d+))?', pkg)
    return f'H. Rept. 119-{m.group(1)}' + (f', Part {m.group(2)}' if m.group(2) else '')


def bill_id_of(b):
    return f"{b['type']}{b['number']}-{b['congress']}"


def bill_label(bill_id):
    typ, num, cong = re.fullmatch(r'([a-z]+)(\d+)-(\d+)', bill_id).groups()
    return f'{BILL_LABEL.get(typ, typ.upper())} {num}', cong


def bill_url(bill_id):
    typ, num, cong = re.fullmatch(r'([a-z]+)(\d+)-(\d+)', bill_id).groups()
    return f'https://www.congress.gov/bill/{cong}th-congress/{BILL_SLUG.get(typ, typ)}/{num}'


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def sha(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def strip_html(s):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s or '')).strip()


def chunk_paragraphs(body, max_chars=MAX_CHUNK_CHARS):
    chunks, cur, n = [], [], 0
    for p in body.split('\n'):
        if cur and n + len(p) + 1 > max_chars:
            chunks.append('\n'.join(cur))
            cur, n = [], 0
        cur.append(p)
        n += len(p) + 1
    if cur:
        chunks.append('\n'.join(cur))
    return chunks


# ---------------------------------------------------------------- metadata readers

def mods_info(pkg):
    root = ET.parse(CACHE / 'mods' / f'{pkg}.xml').getroot()
    local = lambda tag: tag.rsplit('}', 1)[-1]
    info = {'title': None, 'date': None, 'bills': [], 'committees': [], 'submitted_by': None}
    for el in root.iter():
        t = local(el.tag)
        if t == 'title' and info['title'] is None:
            info['title'] = (el.text or '').strip()
        elif t == 'dateIssued' and info['date'] is None:
            info['date'] = (el.text or '').strip()[:10]
        elif t == 'bill':
            info['bills'].append({'context': el.get('context'), 'type': (el.get('type') or '').lower(),
                                  'number': el.get('number'), 'congress': el.get('congress')})
        elif t == 'congCommittee':
            name = next((c.text for c in el if local(c.tag) == 'name' and c.get('type') == 'authority-standard'), None)
            info['committees'].append({'authority_id': el.get('authorityId'), 'name': name})
        elif t == 'congMember' and el.get('role') == 'SUBMITTEDBY':
            info['submitted_by'] = el.get('bioGuideId')
    seen, bills = set(), []
    for b in sorted(info['bills'], key=lambda b: b['context'] != 'PRIMARY'):
        if bill_id_of(b) not in seen:
            seen.add(bill_id_of(b))
            bills.append(b)
    info['bills'] = bills
    return info


def billstatus_info(bill_id):
    typ, num, cong = re.fullmatch(r'([a-z]+)(\d+)-(\d+)', bill_id).groups()
    path = CACHE / 'billstatus' / f'BILLSTATUS-{cong}{typ}{num}.xml'
    if not path.exists() or path.stat().st_size == 0:
        return None
    b = ET.parse(path).getroot().find('bill')
    if b is None:
        return None
    txt = lambda p: (b.findtext(p) or '').strip() or None
    summaries = b.findall('summaries/summary')
    return {
        'bill_id': bill_id, 'congress': int(cong), 'type': typ, 'number': int(num),
        'label': bill_label(bill_id)[0], 'title': txt('title'), 'url': bill_url(bill_id),
        'introduced_date': txt('introducedDate'), 'policy_area': txt('policyArea/name'),
        'legislative_subjects': [e.text for e in b.findall('subjects/legislativeSubjects/item/name') if e.text],
        'sponsor_bioguide': txt('sponsors/item/bioguideId'), 'sponsor_name': txt('sponsors/item/fullName'),
        'cosponsors': [{'bioguide': i.findtext('bioguideId'), 'date': i.findtext('sponsorshipDate'),
                        'original': (i.findtext('isOriginalCosponsor') or '') == 'True'} for i in b.findall('cosponsors/item')],
        'committees': [{'system_code': i.findtext('systemCode'), 'name': i.findtext('name'),
                        'activities': [a.findtext('name') for a in i.findall('activities/item')]} for i in b.findall('committees/item')],
        'latest_action': {'date': txt('latestAction/actionDate'), 'text': txt('latestAction/text')},
        'crs_summary': strip_html(summaries[-1].findtext('text')) if summaries else None,
    }


# ---------------------------------------------------------------- builder

class Builder:
    def __init__(self):
        self.people = roster.load_people()
        self.committees = roster.load_committees()
        self.resolver = roster.Resolver(self.people, self.committees)
        self.t = defaultdict(list)          # output tables
        self.bills_done = set()
        self.domains_seen = {}
        self.issues = []                    # (pkg, kind, detail)
        self.report_stats = []
        self._pb = 0
        self._keys = {}                     # stable evidence ids: fact key -> occurrences
        (OUT / 'text').mkdir(parents=True, exist_ok=True)

    # ---- helpers
    def pb_row(self, person, bill_id, action, source_id, record_id=None, locator=None, event_date=None,
               method='rule', confidence=1.0, **extra):
        self._pb += 1
        row = {'id': None, 'person_id': person.bioguide, 'bill_id': bill_id, 'action': action,
               'vote': None, 'vote_question': None, 'vote_kind': None, 'views_type': None,
               'stance': extra.pop('stance', 'unknown'), 'quote': None,
               'linkage': LINKAGE[action], 'confidence': confidence, 'extraction_method': method,
               'source_id': source_id, 'record_id': record_id, 'locator': locator, 'event_date': event_date,
               'fact_key': f'{person.bioguide}:{bill_id}:{action}'}
        row.update(extra)
        # The id is a hash of the fact, not a running number, so a row keeps its id when reports are added or the
        # pipeline is rerun next week (the CSV consumer can diff on it). Identical facts in one source get #0, #1, ...
        key = '|'.join(str(row.get(k) or '') for k in ('person_id', 'bill_id', 'action', 'source_id', 'vote',
                                                        'vote_question', 'views_type', 'event_date'))
        key += '|' + str((locator or {}).get('line') or '')
        n = self._keys.get(key, 0)
        self._keys[key] = n + 1
        row['id'] = 'pb-' + hashlib.sha1(f'{key}#{n}'.encode('utf-8')).hexdigest()[:12]
        self.t['person_bill'].append(row)
        return row

    def resolve(self, surface, code, date, pkg, kind):
        p, status = self.resolver.resolve(surface, code, date)
        if p is None:
            self.issues.append((pkg, f'{kind}:{status}', surface))
        return p

    def domain(self, domain_id, taxonomy, label):
        if domain_id not in self.domains_seen:
            self.domains_seen[domain_id] = {'domain_id': domain_id, 'taxonomy': taxonomy, 'label': label,
                                            'in_graph': domain_id not in NOT_IN_GRAPH}
        return domain_id

    def member_dict(self, p, surface=None):
        return {'bioguide': p.bioguide, 'name': p.name_full, 'state': p.state, 'district': p.district,
                'party': p.party, 'surface': surface or p.last, 'is_current': p.is_current}

    # ---- bill-level rows (once per bill)
    def add_bill(self, bill_id, bill, reporting_code, pkg):
        if bill_id in self.bills_done:
            return
        self.bills_done.add(bill_id)
        label, cong = bill_label(bill_id)
        row = bill or {'bill_id': bill_id, 'congress': int(cong), 'label': label, 'url': bill_url(bill_id),
                       'title': None, 'policy_area': None, 'sponsor_bioguide': None, 'cosponsors': [], 'committees': []}
        self.t['bills'].append({k: v for k, v in row.items() if k != 'cosponsors'})
        if reporting_code:
            self.t['bill_domain'].append({'bill_id': bill_id, 'domain_id': reporting_code, 'linkage': 'super_high',
                                          'extraction_method': 'metadata', 'source_id': pkg})
        if not bill:
            return
        bs_id = f"BILLSTATUS-{cong}{row['type']}{row['number']}"
        self.t['sources'].append({'source_id': bs_id, 'source_type': 'bill_status', 'url_html': row['url'],
                                  'url_pdf': None, 'publisher': 'GPO/govinfo bulk data', 'media_type': 'gov',
                                  'transcript_kind': 'none', 'title': row['title'], 'citation': label,
                                  'date': row['latest_action']['date'], 'committee_code': None, 'bill_ids': [bill_id],
                                  'retrieved_at': None, 'sha256': None})
        if row['policy_area']:
            d = self.domain('crs:' + slug(row['policy_area']), 'crs_policy_area', row['policy_area'])
            self.t['bill_domain'].append({'bill_id': bill_id, 'domain_id': d, 'linkage': 'super_high',
                                          'extraction_method': 'metadata', 'source_id': bs_id})
        for c in row['committees']:
            code = roster.authority_to_code(c['system_code'] or '')
            if (c['system_code'] or '').endswith('00') and code != reporting_code and code in self.committees:
                self.t['bill_domain'].append({'bill_id': bill_id, 'domain_id': code, 'linkage': 'high',
                                              'extraction_method': 'metadata', 'source_id': bs_id})
        sp = self.people.get(row['sponsor_bioguide'])
        if sp:
            self.pb_row(sp, bill_id, 'sponsored', bs_id, event_date=row['introduced_date'], method='metadata', stance='for')
        for c in row['cosponsors']:
            p = self.people.get(c['bioguide'])
            if p:
                self.pb_row(p, bill_id, 'cosponsored', bs_id, event_date=c['date'], method='metadata', stance='for',
                            original_cosponsor=c['original'])

    # ---- extraction per section kind
    def extract_block(self, b, heading, pkg, code, bill_id, event_date, stats):
        """One roll call -> committee_vote rows."""
        gold, members, status = [], [], 'ok'
        stats['vote_blocks'] += 1
        if b['checksum'] is True:
            stats['vote_checksum_ok'] += 1
        elif b['checksum'] is False:
            status = 'checksum_failed'
            self.issues.append((pkg, 'vote:checksum', f"{b['question']} totals={b['totals']} rows={len(b['votes'])}"))
        if b['missed']:
            status = 'rows_missed' if status == 'ok' else status
            self.issues.append((pkg, 'vote:rows_missed', f"{b['missed']} cells not parsed in '{b['question']}'"))
        q = (f"Roll call {b['rollcall']}: " if b['rollcall'] else '') + (b['question'] or 'unspecified')
        for surface, vote in b['votes']:
            stats['vote_rows'] += 1
            p = self.resolve(surface, code, event_date, pkg, 'vote')
            if not p:
                stats['unresolved'] += 1
                status = 'unresolved_names' if status == 'ok' else status
                continue
            members.append((p, surface))
            gold.append(self.pb_row(p, bill_id, 'committee_vote', pkg, None, {'section_heading': heading, 'line': f'{surface}: {vote.replace("_", " ")}'},   # as render_block prints it
                                    event_date, vote=vote, vote_question=q, vote_kind=classify_question(q),
                                    stance=VOTE_STANCE[vote]))
        return gold, members, status

    def extract_narrative(self, s, pkg, code, bill, bill_id, event_date, stats):
        """Sponsor sentence and amendments offered, from prose."""
        info = parse.parse_legislative_history(s['lines'], bill_label(bill_id)[0] if bill_id else None)
        gold, members, status = [], [], 'ok'
        loc = lambda line: {'section_heading': s['heading'], 'line': line}
        if info['sponsor_surface']:
            # prefer the BILLSTATUS introduced date; a date parsed from prose may belong to a prior Congress's version
            intro = (bill or {}).get('introduced_date') or info['introduced_date']
            if not (intro and '2025-01-03' <= intro <= (event_date or '9999')):
                intro = event_date
            info['introduced_date'] = intro
            p = self.resolve(info['sponsor_surface'], None, intro, pkg, 'sponsor')
            if p:
                members.append((p, info['sponsor_surface']))
                gold.append(self.pb_row(p, bill_id, 'sponsored', pkg, None, loc(info['sponsor_surface']),
                                        info['introduced_date'], stance='for'))
                if bill:
                    stats['sponsor_match'] = bool(stats['sponsor_match']) or p.bioguide == bill['sponsor_bioguide']
            else:
                status = 'unresolved_names'
        seen = set()
        for a in info['amendments']:
            p = self.resolve(a['surface'], code, event_date, pkg, 'amendment')
            if p and (p.bioguide, a['result']) not in seen:   # the vote summary repeats the amendment list
                seen.add((p.bioguide, a['result']))
                members.append((p, a['surface']))
                gold.append(self.pb_row(p, bill_id, 'offered_amendment', pkg, None, loc(a['surface']), event_date,
                                        amendment_result=a['result'], vote_question=f"amendment offered by {a['surface']}"))
        return gold, members, status

    def extract_views(self, s, pkg, code, bill_id, event_date, stats, adverse=False):
        # On an ADVERSE report the committee majority voted the measure down, so minority/dissenting views
        # argue FOR it (resolutions of inquiry are the common case).
        stance_of = (lambda t: 'for' if VIEWS_STANCE[t] == 'against' else VIEWS_STANCE[t]) if adverse else (lambda t: VIEWS_STANCE[t])
        names = parse.parse_signatures(s['lines']) or parse.views_signers_from_heading(s['heading'])
        gold, members, status = [], [], 'ok' if names else 'no_signatures'
        for n in names:
            stats['signers'] += 1
            p = self.resolve(n, code, event_date, pkg, 'signer')
            if not p:
                stats['unresolved'] += 1
                status = 'unresolved_names'
                continue
            stats['signers_resolved'] += 1
            members.append((p, n))
            gold.append(self.pb_row(p, bill_id, 'signed_views', pkg, None, {'section_heading': s['heading'], 'line': n},
                                    event_date, views_type=s['type'].replace('_views', ''), stance=stance_of(s['type'])))
        return gold, members, status

    @staticmethod
    def render_block(b):
        head = f"Roll call {b['rollcall']}: " if b['rollcall'] else ''
        tot = ' '.join(f'{k.replace("_", " ").capitalize()} {n}.' for k, n in b['totals'].items())
        out = [f"On: {head}{b['question'] or 'unspecified'}. {tot}".strip()]
        out.extend(f'{surf}: {vote.replace("_", " ")}' for surf, vote in b['votes'])
        return '\n'.join(out)

    def render(self, s):
        """Normalised text of a whole section (for text/<pkg>.txt)."""
        parts = []
        if s['type'] in ('committee_votes', 'legislative_history'):
            parts += [self.render_block(b) for b in parse.parse_vote_blocks(s['lines'])]
        parts.append('\n'.join(parse.unwrap(s['lines'])))
        return '\n\n'.join(p for p in parts if p)

    # ---- one report
    def build_report(self, pkg):
        """One govinfo package = one or more parts (GPO's 'Book 1', 'Book 2', ...); each part is its own source."""
        mods = mods_info(pkg)
        for part in fetch.parts_of(pkg):
            self.build_part(pkg, part, mods)

    def build_part(self, pkg, part, mods):
        sid = part['id']                            # == pkg for the 834 single-part reports
        path, text_kind = fetch.text_path(sid)      # html edition first, else pdftotext output
        if path is None:
            title, lines = '', []
        elif text_kind == 'html':
            title, lines = parse.load_text(path.read_bytes())
        else:
            title, lines = parse.load_pdf_text(path.read_text(encoding='utf-8', errors='replace'))
        authority = part['committee_authority'] or (mods['committees'][0]['authority_id'] if mods['committees'] else None)
        comm = next((c for c in mods['committees'] if c['authority_id'] == authority), mods['committees'][0] if mods['committees'] else None)
        code = roster.authority_to_code(authority) if authority else None
        comm_name = self.committees[code]['name'] if code in self.committees else (comm['name'] if comm else 'unknown committee')
        if code in self.committees:
            self.domain(code, 'house_committee', comm_name)
        primary = next((b for b in mods['bills'] if b['context'] == 'PRIMARY'), mods['bills'][0] if mods['bills'] else None)
        bill_id = bill_id_of(primary) if primary else None
        bill = billstatus_info(bill_id) if bill_id else None
        date = mods['date']
        url = (part['pdf'] if text_kind == 'pdf' else part['html']) or part['html'] or part['pdf'] or f'{GOVINFO}/app/details/{pkg}'
        cite = citation(pkg) + (f", {part['part_name']}" if part['part_name'] else '')
        stats = {'pkg': sid, 'committee': code, 'bill_id': bill_id, 'text': text_kind or 'unavailable',
                 'records': 0, 'tokens': 0, 'llm_tokens': 0, 'vote_blocks': 0, 'vote_checksum_ok': 0, 'vote_rows': 0,
                 'signers': 0, 'signers_resolved': 0, 'sponsor_match': None, 'unresolved': 0, 'statuses': Counter()}
        self.report_stats.append(stats)
        self.t['sources'].append({'source_id': sid, 'package_id': pkg, 'part_name': part['part_name'],
                                  'source_type': 'committee_report', 'url_html': part['html'], 'url_pdf': part['pdf'],
                                  'text_source': text_kind, 'publisher': 'GPO/govinfo',
                                  'media_type': 'gov', 'transcript_kind': 'official', 'title': mods['title'] or title,
                                  'citation': cite, 'date': date, 'committee_code': code,
                                  'bill_ids': [bill_id_of(b) for b in mods['bills']], 'retrieved_at': None,
                                  'sha256': sha('\n'.join(lines)) if lines else None})
        if bill_id:
            self.add_bill(bill_id, bill, code, pkg)
        if not lines:
            self.issues.append((sid, 'text:unavailable', 'govinfo has published neither the html edition nor the PDF yet'))
            return
        if code == 'HSRU' or not bill_id:          # Rules reports and bill-less reports: metadata only
            return
        if pkg in SKIP_PKGS or sid in SKIP_PKGS:    # compilations whose 'views' are other committees' letters
            self.issues.append((sid, 'skipped', SKIP_PKGS.get(pkg) or SKIP_PKGS.get(sid)))
            return

        sections = parse.split_sections(lines)
        lh = next((s for s in sections if s['type'] == 'legislative_history'), None)
        lh_info = parse.parse_legislative_history(lh['lines']) if lh else parse.parse_legislative_history([])
        # The legislative-history section often recounts prior Congresses; only trust a 'considered on' date that
        # falls inside the 119th and no later than the report itself (44 reports carried 2013-2024 dates otherwise).
        cd = lh_info['considered_date']
        event_date = cd if (cd and '2025-01-03' <= cd <= (date or '9999')) else date
        action = parse.committee_action(sections[0]['lines'])
        adverse = bool(action and 'adversely' in action)

        # full normalised text + offsets
        rendered, offset, spans = [], 0, {}
        for i, s in enumerate(sections):
            text = (f"[SECTION] {s['heading']}\n" if s['type'] != 'front' else '') + self.render(s)
            spans[i] = (offset, offset + len(text))
            rendered.append(text)
            offset += len(text) + 2
        (OUT / 'text' / f'{sid}.txt').write_text('\n\n'.join(rendered), encoding='utf-8')

        ca_committee = [self.people[m['bioguide']] for m in self.committees.get(code, {'members': []})['members']
                        if m['bioguide'] in self.people and self.people[m['bioguide']].state == 'CA']
        sponsor = self.people.get(bill['sponsor_bioguide']) if bill else None
        label, cong = bill_label(bill_id)
        header_doc = f"[DOCUMENT] {cite} | {comm_name} | filed {date} | govinfo {sid}"
        header_bill = (f"[BILL] {label} ({cong}th): {(bill or {}).get('title') or mods['title']}"
                       f" | policy area: {(bill or {}).get('policy_area') or 'n/a'}"
                       f" | sponsor: {sponsor.label + ', ' + sponsor.bioguide if sponsor else 'n/a'}"
                       f" | committee action: {action or 'n/a'}")
        ordinal = Counter()

        def emit(i, s, body, gold, members, status, needs_llm, kind=None, part=None):
            kind = kind or s['type']
            ordinal[kind] += 1
            record_id = f"{sid}:{kind}:{ordinal[kind]}"
            for r in gold:
                r['record_id'] = record_id
            scope = {p.bioguide: self.member_dict(p, surf) for p, surf in members}
            for p in ca_committee:
                scope.setdefault(p.bioguide, self.member_dict(p))
            members_line = '; '.join(f'{m["bioguide"]} {m["name"]} ({m["party"]}-{m["state"]}-{m["district"]:02d}) "{m["surface"]}"'
                                     for m in scope.values())
            part_line = f"[PART {part[0]}/{part[1]}]\n" if part and part[1] > 1 else ''
            text = f"{header_doc}\n{header_bill}\n[MEMBERS] {members_line}\n[SECTION] {s['heading']}\n{part_line}{body}"
            ca = sorted(b for b, m in scope.items() if m['state'] == 'CA')
            rec = {'record_id': record_id, 'source_id': sid, 'package_id': pkg, 'source_type': 'committee_report',
                   'section_type': kind, 'congress': 119, 'chamber': 'house', 'committee_code': code,
                   'report_citation': cite, 'report_date': date, 'primary_bill_id': bill_id,
                   'bill_ids': [bill_id_of(b) for b in mods['bills']], 'url': url,
                   'locator': {'section_heading': s['heading'], 'char_start': spans[i][0], 'char_end': spans[i][1],
                               'part': part[0] if part else None},
                   'members_in_scope': list(scope.values()), 'ca_bioguides': ca, 'has_ca_member': bool(ca),
                   'needs_llm': needs_llm, 'parse_status': status, 'n_chars': len(text),
                   'n_tokens_est': len(text) // 4, 'text_sha256': sha(text), 'text': text}
            self.t['records'].append(rec)
            stats['records'] += 1
            stats['tokens'] += rec['n_tokens_est']
            stats['statuses'][status] += 1
            if needs_llm:
                stats['llm_tokens'] += rec['n_tokens_est']
            if gold and status == 'ok':
                keep = ('person_id', 'bill_id', 'action', 'vote', 'vote_question', 'views_type', 'stance')
                self.t['sft'].append({'record_id': record_id, 'primary_bill_id': bill_id, 'messages': [
                    {'role': 'system', 'content': SYSTEM_PROMPT},
                    {'role': 'user', 'content': text},
                    {'role': 'assistant', 'content': json.dumps(
                        [{k: r[k] for k in keep if r.get(k) is not None} for r in gold], ensure_ascii=False)}]})

        for i, s in enumerate(sections):
            if s['type'] not in RECORD_TYPES:
                continue
            if s['type'] in parse.VIEWS_TYPES:
                body = '\n'.join(parse.unwrap(s['lines']))
                if len(body) < 300:
                    continue                          # cover-page "MINORITY VIEWS" line, not a section
                gold, members, status = self.extract_views(s, sid, code, bill_id, event_date, stats, adverse)
                if s['type'] == 'views' and status == 'no_signatures':
                    continue                          # "Views of Committee Members" intro paragraph
                chunks = chunk_paragraphs(body)
                for k, chunk in enumerate(chunks, 1):
                    emit(i, s, chunk, gold if k == len(chunks) else [], members, status, True, part=(k, len(chunks)))
            elif s['type'] in ('committee_votes', 'legislative_history'):
                blocks = parse.parse_vote_blocks(s['lines'])
                for b in blocks:
                    gold, members, status = self.extract_block(b, s['heading'], sid, code, bill_id, event_date, stats)
                    emit(i, s, self.render_block(b), gold, members, status, False, kind='committee_votes')
                if s['type'] == 'legislative_history' or not blocks:
                    body = '\n'.join(parse.unwrap(s['lines']))
                    gold, members, status = self.extract_narrative(s, sid, code, bill, bill_id, event_date, stats)
                    if s['type'] == 'committee_votes':
                        status = 'narrative' if gold else parse.votes_status(s['lines'])
                    if body:
                        emit(i, s, body, gold, members, status, False)
            elif not ordinal['purpose']:               # one context record per report, capped
                body = '\n'.join(parse.unwrap(s['lines']))
                if len(body) > MAX_PURPOSE_CHARS:
                    body = body[:MAX_PURPOSE_CHARS].rsplit(' ', 1)[0] + ' [truncated; full text in text/]'
                emit(i, s, body, [], [], 'ok', False)

    # ---- static tables and output
    def finish(self):
        for code, c in self.committees.items():
            self.domain(code, 'house_committee', c['name'])
            for m in c['members']:
                if m['bioguide'] in self.people:
                    self.t['person_committee'].append({'bioguide': m['bioguide'], 'committee_code': code, 'role': m['role'],
                                                       'rank': m['rank'], 'party': m['party'],
                                                       'source': 'unitedstates/congress-legislators committee-membership-current.yaml'})
        for p in self.people.values():
            t = 'Mr.' if p.gender == 'M' else 'Ms.'
            self.t['persons'].append({**p.__dict__, 'surface_forms': [f'{t} {p.last}', f'{t} {p.last} of {p.state}', f'{t} {p.last} ({p.state})', p.name_full],
                                      'congress_gov_url': f'https://www.congress.gov/member/{slug(p.name_full)}/{p.bioguide}'})
        self.t['domains'] = list(self.domains_seen.values())
        splits = {'train': [], 'val': [], 'test': []}

        def split_of(key):
            h = int(hashlib.md5(key.encode()).hexdigest(), 16) % 10
            return 'test' if h == 9 else 'val' if h == 8 else 'train'
        for r in self.t['records']:
            r['split'] = split_of(r['primary_bill_id'] or r['source_id'])
            splits[r['split']].append(r['record_id'])
        for e in self.t['sft']:
            e['split'] = split_of(e['primary_bill_id'] or e['record_id'])
        for name, rows in self.t.items():
            with open(OUT / f'{name}.jsonl', 'w', encoding='utf-8') as f:
                for r in rows:
                    f.write(json.dumps(r, ensure_ascii=False) + '\n')
        json.dump(splits, open(OUT / 'splits.json', 'w'), indent=1)
        (OUT / 'pilot_report.md').write_text(self.report_md(), encoding='utf-8')

    def report_md(self):
        rs = self.report_stats
        recs = self.t['records']
        pb = self.t['person_bill']
        lines = ['# Pilot report', '',
                 f'Reports: {len(rs)} ({sum(s["text"] == "unavailable" for s in rs)} without text yet, {sum(s["text"] == "pdf" for s in rs)} from the PDF) | records: {len(recs)} | '
                 f'tokens (est, chars/4): {sum(r["n_tokens_est"] for r in recs):,} | of which need the LLM: '
                 f'{sum(r["n_tokens_est"] for r in recs if r["needs_llm"]):,} in {sum(r["needs_llm"] for r in recs)} records',
                 f'person_bill rows: {len(pb)} ({dict(Counter(r["extraction_method"] for r in pb))}) | by action: {dict(Counter(r["action"] for r in pb))}',
                 f'CA person_bill rows: {sum(self.people[r["person_id"]].state == "CA" for r in pb)} | sft examples: {len(self.t["sft"])}',
                 f'records by section_type: {dict(Counter(r["section_type"] for r in recs))}',
                 f'records by parse_status: {dict(Counter(r["parse_status"] for r in recs))}', '',
                 '| report | committee | bill | records | tokens | llm tokens | vote blocks (checksum ok) | vote rows | signers (resolved) | sponsor==metadata | unresolved | statuses |',
                 '|---|---|---|---|---|---|---|---|---|---|---|---|']
        for s in rs:
            lines.append(f"| {s['pkg']} | {s['committee']} | {s['bill_id']} | {s['records']} | {s['tokens']:,} | {s['llm_tokens']:,} | "
                         f"{s['vote_blocks']} ({s['vote_checksum_ok']}) | {s['vote_rows']} | {s['signers']} ({s['signers_resolved']}) | "
                         f"{s['sponsor_match']} | {s['unresolved']} | {'text unavailable' if s['text'] != 'ok' else dict(s['statuses'])} |")
        lines += ['', '## Issues', '']
        counted = Counter((pkg, kind, detail) for pkg, kind, detail in self.issues)
        for (pkg, kind, detail), n in counted.items():
            lines.append(f'- {pkg} {kind}: {detail}' + (f' (x{n})' if n > 1 else ''))
        return '\n'.join(lines) + '\n'
