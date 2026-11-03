"""Export module 1 output in the OWL repo's contract shapes (az30667176-sudo/owl, packages/contract/README.md).

  python3 -I m1/export_owl.py                          # out_full/ -> out_full/owl/
  python3 -I m1/export_owl.py --in out --out out/owl   # the 20-report sample
  python3 -I m1/export_owl.py --state CA               # only views sections with >= 1 signer from that state (debug subsets)

Writes
  records/<id>.json     contract A: one file per views chunk (speaker tag lists the signers) + one per committee vote
                        section with per-member tallies (ids *-committee-votes-*; for quote verification only, not for Muse)
  records_index.jsonl   one line per record: source record id, report, bill, signers, signer states/parties, tokens
  people.json           contract B people file: every sitting House member, id = bioguide id
  summary.json          counts

Validate with the repo's checker (node >= 18):
  node ../owl/packages/contract/validate.mjs $(printf -- '--record %s ' out_full/owl/records/*.json)
"""
import argparse
import collections
import datetime
import json
import pathlib
import re
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from m1 import roster  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
HEADER_TAGS = ('[DOCUMENT]', '[BILL]', '[MEMBERS]', '[SECTION]', '[PART ')
BILL_PATH = {'hr': 'house-bill', 'hres': 'house-resolution', 'hjres': 'house-joint-resolution',
             'hconres': 'house-concurrent-resolution', 's': 'senate-bill', 'sres': 'senate-resolution',
             'sjres': 'senate-joint-resolution', 'sconres': 'senate-concurrent-resolution'}


def congress_url(bill_id):
    """'hconres14-119' -> https://www.congress.gov/bill/119th-congress/house-concurrent-resolution/14"""
    m = re.fullmatch(r'([a-z]+)(\d+)-(\d+)', bill_id or '')
    if not m or m.group(1) not in BILL_PATH:
        return None
    return f'https://www.congress.gov/bill/{m.group(3)}th-congress/{BILL_PATH[m.group(1)]}/{m.group(2)}'


def body_of(text):
    """Drop the [DOCUMENT]/[BILL]/[MEMBERS]/[SECTION]/[PART] header lines; keep the section text verbatim."""
    lines = text.split('\n')
    i = 0
    while i < len(lines) and lines[i].startswith(HEADER_TAGS):
        i += 1
    return '\n'.join(lines[i:]).strip('\n')


def export_records(src, out, people, state=None):
    recs = [json.loads(line) for line in open(src / 'records.jsonl', encoding='utf-8')]
    pb = [json.loads(line) for line in open(src / 'person_bill.jsonl', encoding='utf-8')]
    signers_by_rid = collections.defaultdict(list)
    for p in pb:
        if p['action'] == 'signed_views' and p['record_id']:
            signers_by_rid[p['record_id']].append(p['person_id'])

    groups = {}                                   # one views section -> its chunks, in order
    for r in recs:
        if r['needs_llm']:
            groups.setdefault((r['source_id'], r['section_type'], r['locator']['char_start']), []).append(r)

    rdir = out / 'records'
    rdir.mkdir(parents=True, exist_ok=True)
    for old in rdir.glob('rec-*.json'):
        old.unlink()
    index, stats = [], collections.Counter()
    for rs in groups.values():
        signers = []                              # signature order, as printed
        for r in rs:
            for b in signers_by_rid.get(r['record_id'], []):
                if b in people and b not in signers:
                    signers.append(b)
        if not signers:
            stats['sections_skipped_no_signers'] += 1
            continue
        states = sorted({people[b].state for b in signers})
        parties = dict(collections.Counter(people[b].party for b in signers))
        if state and state not in states:
            stats['sections_skipped_state_filter'] += 1
            continue
        tag = '<' + ', '.join('Rep. ' + people[b].name_full for b in signers) + '>: '
        n = len(rs)
        for r in rs:
            ordinal = r['record_id'].rsplit(':', 1)[1]
            rid = f"rec-{r['report_date']}-{r['source_id'].lower()}-{r['section_type'].replace('_', '-')}-{ordinal}"
            part = r['locator']['part'] or 1
            content = tag + body_of(r['text'])
            heading = ' '.join(r['locator']['section_heading'].split()).title()
            n_tok = len(content) // 4
            desc = (f"{r['report_citation']} ({r['committee_code']}), {heading}, part {part}/{n}. "
                    f"Signed by {len(signers)} member(s) from {len(states)} state(s). Views section of a House committee "
                    f"report (govinfo {r['source_id']}): the single speaker tag lists every signer; the model "
                    f"decides stance and quote.")
            rec = {
                '_meta': {'description': desc,
                          'ingest': {'source_record_id': r['record_id'], 'committee': r['committee_code'],
                                     'bill_id': r['primary_bill_id'], 'kind': 'views', 'views_type': r['section_type'],
                                     'part': part, 'parts': n, 'parse_status': r['parse_status'],
                                     'signer_states': states, 'signer_parties': parties, 'n_tokens_est': n_tok}},
                'id': rid,
                'content': content,
                'source': {'url_link': r['url'], 'media_type': 'gov', 'media_name': 'govinfo',
                           'transcript': 'official_transcript'},
                'hints': {'date': r['report_date'], 'persons': signers,
                          'bill_urls': [u for u in (congress_url(b) for b in r['bill_ids']) if u]},
            }
            with open(rdir / f'{rid}.json', 'w', encoding='utf-8') as f:
                json.dump(rec, f, indent=2, ensure_ascii=False)
                f.write('\n')
            index.append({'id': rid, 'kind': 'views', 'source_record_id': r['record_id'], 'report': r['report_citation'],
                          'committee': r['committee_code'], 'bill_id': r['primary_bill_id'],
                          'views_type': r['section_type'], 'part': part, 'parts': n, 'signers': signers,
                          'signer_states': states, 'signer_parties': parties, 'n_tokens_est': n_tok})
            stats['records'] += 1
            stats['tokens_est'] += n_tok
            for pty, k in parties.items():
                stats[f'records_signed_by_{pty}'] += 1
        stats['sections'] += 1
    with open(out / 'records_index.jsonl', 'w', encoding='utf-8') as f:
        for row in index:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    return stats


def _norm(t):
    return re.sub(r'\s+', ' ', t.replace('\u2018', "'").replace('\u2019', "'").replace('\u201c', '"').replace('\u201d', '"')).strip().lower()


def export_vote_records(src, out, people):
    """Contract-A records for committee vote sections that yielded per-member votes.

    Not for Muse extraction. They exist so that vote-derived stance rows (process option 3b) can carry a
    `record_id` and a `quote` ("Mr. Neal: yea") that the repo validator verifies against record content, as the
    statements schema requires for real data. Content = the printed tally table(s) transcribed one member per
    line, under a single `<other>:` tag (the committee clerk's record, nobody speaking)."""
    recs = [json.loads(line) for line in open(src / 'records.jsonl', encoding='utf-8')]
    rows_by_rid = collections.defaultdict(list)
    for line in open(src / 'person_bill.jsonl', encoding='utf-8'):
        p = json.loads(line)
        if p['action'] == 'committee_vote' and p['record_id']:
            rows_by_rid[p['record_id']].append(p)
    rdir = out / 'records'
    for old in rdir.glob('rec-*-committee-votes-*.json'):
        old.unlink()
    index, stats = [], collections.Counter()
    for r in recs:
        if r['section_type'] != 'committee_votes' or r['record_id'] not in rows_by_rid:
            continue
        rows = rows_by_rid[r['record_id']]
        ordinal = r['record_id'].rsplit(':', 1)[1]
        rid = f"rec-{r['report_date']}-{r['source_id'].lower()}-committee-votes-{ordinal}"
        content = '<other>: ' + body_of(r['text'])
        norm_content = _norm(content)
        voters = []
        for p in rows:
            if p['person_id'] in people and p['person_id'] not in voters:
                voters.append(p['person_id'])
        tally = collections.Counter(p['vote'] for p in rows)
        quotable = sum(1 for p in rows if p['vote'] in ('yea', 'nay') and p['locator']
                       and _norm(p['locator']['line']) in norm_content)
        dates = collections.Counter(p['event_date'] for p in rows if p['event_date'])
        date = dates.most_common(1)[0][0] if dates else r['report_date']
        n_tok = len(content) // 4
        desc = (f"{r['report_citation']} ({r['committee_code']}), Committee Votes, part {ordinal}. Roll-call tallies "
                f"transcribed from the printed vote table(s), one 'Name: yea|nay' line per member: {len(rows)} member "
                f"votes ({tally.get('yea', 0)} yea, {tally.get('nay', 0)} nay). NOT for model extraction: this record "
                f"exists so vote-derived stance rows (process option 3b) can cite a quote the validator can verify. "
                f"The <other> tag is the committee clerk's record, not a speaker. Parse status: {r['parse_status']}.")
        rec = {
            '_meta': {'description': desc,
                      'ingest': {'source_record_id': r['record_id'], 'committee': r['committee_code'],
                                 'bill_id': r['primary_bill_id'], 'kind': 'committee_votes', 'part': int(ordinal),
                                 'parse_status': r['parse_status'], 'n_votes': len(rows),
                                 'n_yea': tally.get('yea', 0), 'n_nay': tally.get('nay', 0),
                                 'n_quotable_lines': quotable, 'n_tokens_est': n_tok}},
            'id': rid,
            'content': content,
            'source': {'url_link': r['url'], 'media_type': 'gov', 'media_name': 'govinfo',
                       'transcript': 'official_transcript'},
            'hints': {'date': date, 'persons': voters,
                      'bill_urls': [u for u in (congress_url(b) for b in r['bill_ids']) if u]},
        }
        with open(rdir / f'{rid}.json', 'w', encoding='utf-8') as f:
            json.dump(rec, f, indent=2, ensure_ascii=False)
            f.write('\n')
        index.append({'id': rid, 'kind': 'committee_votes', 'source_record_id': r['record_id'],
                      'report': r['report_citation'], 'committee': r['committee_code'], 'bill_id': r['primary_bill_id'],
                      'views_type': None, 'part': int(ordinal), 'parts': None, 'signers': voters,
                      'signer_states': sorted({people[b].state for b in voters}),
                      'signer_parties': dict(collections.Counter(people[b].party for b in voters)),
                      'n_votes': len(rows), 'n_quotable_lines': quotable, 'n_tokens_est': n_tok})
        stats['vote_records'] += 1
        stats['vote_rows'] += len(rows)
        stats['vote_rows_yea_nay'] += tally.get('yea', 0) + tally.get('nay', 0)
        stats['vote_quotable_lines'] += quotable
        stats['vote_tokens_est'] += n_tok
    with open(out / 'records_index.jsonl', 'a', encoding='utf-8') as f:
        for row in index:
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
    return stats


def export_people(out):
    """Contract B people.json: every House member with a 119th-Congress term, sitting today or departed.

    Departed members (left during the 119th) are included because they signed views and cast votes in 2025;
    without them every statement attributed to them fails the checker's `unknown person` rule. The schema allows
    no extra field, so they are listed in _meta.description; a `left` date would be a contract change."""
    today = datetime.date.today().isoformat()
    rows, departed = [], []
    for fname in ('legislators-current.yaml', 'legislators-historical.yaml'):
        for p in yaml.safe_load(open(roster.R / fname, encoding='utf-8')):
            terms = [t for t in p['terms'] if t['type'] in ('rep', 'del', 'res')
                     and t['start'] < roster.C119_END and t['end'] > roster.C119_START]
            if not terms:
                continue
            t = terms[-1]
            n, d = p['name'], int(t.get('district') or 0)
            row = {'id': p['id']['bioguide'], 'bioguide_id': p['id']['bioguide'],
                   'name': 'Rep. ' + (n.get('official_full') or f"{n.get('first', '')} {n.get('last', '')}"),
                   'chamber': 'house', 'state': t['state'],
                   'district': f"{t['state']}-{d:02d}" if d else f"{t['state']}-AL",
                   'party': roster.PARTY.get(t.get('party'), 'I'), 'gender': p['bio']['gender'],
                   'since': int(min(x['start'] for x in p['terms'])[:4])}
            if t['end'] <= today:
                departed.append((row, t['end']))
            else:
                rows.append(row)
    rows.sort(key=lambda r: (r['state'], r['district']))
    departed.sort(key=lambda x: x[1])
    rows += [r for r, _ in departed]
    doc = {'_meta': {'description': f'U.S. House members of the 119th Congress: {len(rows) - len(departed)} sitting on {today} '
                                    f'(voting members and delegates) plus {len(departed)} who left during the 119th, listed last: '
                                    + '; '.join(f"{r['name'].replace('Rep. ', '')} ({r['state']}, left {e})" for r, e in departed) + '. '
                                    'Source: unitedstates/congress-legislators legislators-current.yaml + legislators-historical.yaml. '
                                    'id = bioguide id; since = first year in any congressional office. '
                                    'Generated by services/ingest (module 1).'},
           'people': rows}
    with open(out / 'people.json', 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write('\n')
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', default='out_full')
    ap.add_argument('--out', default=None)
    ap.add_argument('--state', default=None, help='keep only sections with a signer from this state (debug)')
    a = ap.parse_args()
    src = ROOT / a.src
    out = pathlib.Path(a.out) if a.out else src / 'owl'
    out.mkdir(parents=True, exist_ok=True)
    people = roster.load_people()
    stats = export_records(src, out, people, a.state)
    stats.update(export_vote_records(src, out, people))
    stats['people'] = export_people(out)
    stats['state_filter'] = a.state or 'none (national)'
    json.dump(stats, open(out / 'summary.json', 'w'), indent=2)
    for k, v in stats.items():
        print(f'{k:36} {v:,}' if isinstance(v, int) else f'{k:36} {v}')


if __name__ == '__main__':
    main()
