#!/usr/bin/env python3
"""Export everything module 1 extracted as flat CSV tables (for a consumer who builds the JSON himself).

  python3 -I m1/export_csv.py [--in out_full] [--out out_full/csv]

Reads the module-1 outputs (records.jsonl, person_bill.jsonl, bills.jsonl, bill_domain.jsonl, sources.jsonl,
person_committee.jsonl, domains.jsonl) plus the contract-A export (owl/records/*.json, owl/records_index.jsonl,
owl/people.json, owl/issues.json, owl/bill_issues.jsonl) and writes:

  records.csv          one row per text record (views chunk or committee-vote tally), verbatim `content` included
  evidence.csv         one row per person x bill fact (sponsor, cosponsor, committee vote, signed views, amendment)
  people.csv           every House member with a 119th term, sitting or departed (with left_date)
  bills.csv            every bill a report accompanies: metadata, sponsor, committees, seed issues, reports
  issues.csv           seed level-3 issues under the web team's subcommittee ids
  bill_committees.csv  bill -> committee / CRS policy area (m2m)
  committee_seats.csv  current committee membership (chair, ranking member, rank, side)
  committees.csv       committee code -> name -> web taxonomy id
  reports.csv          one row per House report: what it is, what text we have, what we parsed from it
  README.md            data dictionary
  MANIFEST.csv         rows, bytes, sha256 per file

Conventions: UTF-8, LF, RFC 4180 quoting (python csv), header row, empty string = unknown/not applicable,
multi-valued cells joined with "|" (no spaces), dates ISO yyyy-mm-dd, ids are bioguide ids (people) and
congress.gov-style bill ids (hr1382-119).
"""
import argparse
import collections
import csv
import datetime
import hashlib
import json
import re
import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from m1 import fetch, roster  # noqa: E402
from m1.export_owl import congress_url  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
J = '|'


def jl(path):
    return [json.loads(line) for line in open(path, encoding='utf-8')]


def write_csv(path, header, rows):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(header)
        for r in rows:
            w.writerow(['' if v is None else (J.join(map(str, v)) if isinstance(v, (list, tuple)) else v) for v in r])
    return len(rows)


_STATUS_RULES = [   # first match wins; BILLSTATUS latestAction text -> the web team's enum (owl #28)
    ('enacted', r'Became Public Law|Signed by President'),
    ('failed', r'\bFailed\b|Motion to reconsider .*? rejected|not agreed to'),
    ('passed_senate', r'Passed Senate|Passed/agreed to in Senate|Cleared for White House|Presented to President|Resolving differences'),
    ('passed_house', r'\bSenat(?:e|or)\b|Cloture|Received in the Senate|Senate Legislative Calendar|referred to the Committee on [^.]*\.$|Message on Senate action|'
                     r'Passed/agreed to in House|On passage Passed|On agreeing to the resolution Agreed to|Motion to reconsider laid on the table'),
    ('committee', r'Reported|Placed on the (?:Union|House) Calendar|Ordered to be Reported|Committee Consideration and Mark-up|'
                  r'Subcommittee|Committee Hearings|Referred to the (?:House )?Committee|Forwarded by Subcommittee'),
    ('introduced', r'Introduced|Sponsor introductory'),
]


def bill_status(latest_action_text):
    for status, rx in _STATUS_RULES:
        if re.search(rx, latest_action_text, re.I):
            return status
    return 'unknown' if latest_action_text else ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='src', default='out_full')
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    src = ROOT / a.src
    owl = src / 'owl'
    out = pathlib.Path(a.out) if a.out else src / 'csv'
    out.mkdir(parents=True, exist_ok=True)
    today = datetime.date.today().isoformat()

    # ---- lookups -----------------------------------------------------------------------------------------------
    domains = {d['domain_id']: d for d in jl(src / 'domains.jsonl')}
    cname = lambda code: domains.get(code, {}).get('label', '') if code else ''
    bills = {b['bill_id']: b for b in jl(src / 'bills.jsonl')}
    sources = {s['source_id']: s for s in jl(src / 'sources.jsonl')}
    people_json = json.load(open(owl / 'people.json', encoding='utf-8'))['people']
    people = {p['id']: p for p in people_json}
    persons_internal = {p['bioguide']: p for p in jl(src / 'persons.jsonl')}
    index = jl(owl / 'records_index.jsonl')
    rec_id_of = {r['source_record_id']: r['id'] for r in index}           # internal record id -> contract-A id
    bill_issues = {r['bill_id']: r for r in jl(owl / 'bill_issues.jsonl')}
    issues = json.load(open(owl / 'issues.json', encoding='utf-8'))['issues']
    bill_domain = jl(src / 'bill_domain.jsonl')
    reporting = collections.defaultdict(list)
    for r in bill_domain:
        if r['domain_id'].startswith('HS') and r['linkage'] == 'super_high':
            reporting[r['bill_id']].append(r['domain_id'])
    reports_of_bill = collections.defaultdict(list)
    for s in sources.values():
        if s['source_type'] == 'committee_report':
            for b in s['bill_ids']:
                reports_of_bill[b].append(s['citation'])
    internal_recs = jl(src / 'records.jsonl')
    counts = {}

    def pname(b):
        if b in people:
            return people[b]['name'], people[b]['party'], people[b]['state'], people[b]['district']
        p = persons_internal.get(b)
        if p:
            return 'Rep. ' + p['name_full'], p['party'], p['state'], f"{p['state']}-{p['district']:02d}" if p['district'] else f"{p['state']}-AL"
        return '', '', '', ''

    # ---- records.csv -------------------------------------------------------------------------------------------
    rows = []
    content_of = {}                               # record id -> content, to check quote lines below
    for ix in sorted(index, key=lambda r: r['id']):
        rec = json.load(open(owl / 'records' / f"{ix['id']}.json", encoding='utf-8'))
        content_of[rec['id']] = rec['content']
        ing = rec['_meta']['ingest']
        b = bills.get(ing['bill_id'], {})
        rows.append([rec['id'], ing['kind'], ing.get('views_type') or '', ing.get('part') or '', ing.get('parts') or '',
                     ix['report'], rec['hints']['date'], ing['committee'], cname(ing['committee']),
                     ing['bill_id'] or '', b.get('label', ''), b.get('title', ''), rec['source']['url_link'],
                     ing.get('parse_status', ''), ing.get('n_votes', ''), ing.get('n_quotable_lines', ''),
                     ing['n_tokens_est'], len(rec['hints']['persons']), rec['hints']['persons'],
                     rec['hints']['bill_urls'], rec['content']])
    counts['records.csv'] = write_csv(out / 'records.csv',
        ['record_id', 'kind', 'views_type', 'part', 'parts', 'report_citation', 'date', 'committee_code', 'committee_name',
         'bill_id', 'bill_label', 'bill_title', 'source_url', 'parse_status', 'n_votes', 'n_quotable_vote_lines',
         'n_tokens_est', 'n_persons', 'person_bioguides', 'bill_urls', 'content'], rows)

    # ---- evidence.csv ------------------------------------------------------------------------------------------
    rows = []
    for e in jl(src / 'person_bill.jsonl'):
        name, party, state, district = pname(e['person_id'])
        b = bills.get(e['bill_id'], {})
        s = sources.get(e['source_id'], {})
        loc = e.get('locator') or {}
        if e['source_id'].startswith('BILLSTATUS'):
            src_url = congress_url(e['bill_id']) or ''
            committee = (reporting.get(e['bill_id']) or [''])[0]
        else:
            src_url = s.get('url_html', '')
            committee = s.get('committee_code', '')
        rid = rec_id_of.get(e['record_id'], '') if e.get('record_id') else ''
        line = loc.get('line', '')
        if e['action'] == 'signed_views' and rid and line not in content_of.get(rid, line):
            # the signature block sits in an earlier chunk (a views section that ends with legislative text):
            # quote the speaker tag's form of the name instead, which every chunk carries
            line = name[5:] if name.startswith('Rep. ') else name
        rows.append([e['id'], e['person_id'], name, party, state, district, e['bill_id'], b.get('label', ''),
                     e['action'], e.get('vote') or '', e.get('vote_question') or '', e.get('vote_kind') or '', e.get('views_type') or '',
                     e['stance'], e.get('event_date') or '', committee, cname(committee),
                     s.get('citation', '') if s.get('source_type') == 'committee_report' else 'BILLSTATUS',
                     e['source_id'], rid,
                     loc.get('section_heading', ''), line, e['extraction_method'], e['confidence'],
                     e['linkage'], src_url])
    counts['evidence.csv'] = write_csv(out / 'evidence.csv',
        ['evidence_id', 'person_bioguide', 'person_name', 'party', 'state', 'district', 'bill_id', 'bill_label', 'action',
         'vote', 'vote_question', 'vote_kind', 'views_type', 'stance_toward_bill', 'event_date', 'committee_code', 'committee_name',
         'source_report', 'source_id', 'record_id', 'section_heading', 'quote_line', 'extraction_method', 'confidence',
         'linkage', 'source_url'], rows)

    # ---- people.csv --------------------------------------------------------------------------------------------
    term_end = {}
    for fname in ('legislators-current.yaml', 'legislators-historical.yaml'):
        for p in yaml.safe_load(open(roster.R / fname, encoding='utf-8')):
            terms = [t for t in p['terms'] if t['type'] in ('rep', 'del', 'res')
                     and t['start'] < roster.C119_END and t['end'] > roster.C119_START]
            if terms:
                term_end[p['id']['bioguide']] = terms[-1]['end']
    seats = collections.defaultdict(list)
    for s in jl(src / 'person_committee.jsonl'):
        seats[s['bioguide']].append(s['committee_code'])
    rows = []
    for p in people_json:
        end = term_end.get(p['id'], '')
        departed = bool(end) and end <= today
        rows.append([p['id'], p['name'], p['state'], p['district'], p['party'], p['gender'], p['since'],
                     'departed' if departed else 'sitting', end if departed else '', sorted(seats.get(p['id'], []))])
    counts['people.csv'] = write_csv(out / 'people.csv',
        ['bioguide_id', 'name', 'state', 'district', 'party', 'gender', 'since', 'status', 'left_date', 'committee_codes'], rows)

    # ---- bills.csv ---------------------------------------------------------------------------------------------
    rows = []
    for bid, b in sorted(bills.items()):
        bi = bill_issues.get(bid, {})
        act = (b.get('latest_action') or {}).get('text', '') or ''
        rows.append([bid, b['label'], b['title'], b['url'], b.get('introduced_date') or '', b.get('policy_area') or '',
                     b.get('legislative_subjects') or [], b.get('sponsor_bioguide') or '', b.get('sponsor_name') or '',
                     sorted(set(reporting.get(bid, []))), [c['system_code'] for c in b.get('committees', [])],
                     bi.get('issues', []), bi.get('method', ''), bill_status(act), (b.get('latest_action') or {}).get('date', ''),
                     act, sorted(set(reports_of_bill.get(bid, [])))])
    counts['bills.csv'] = write_csv(out / 'bills.csv',
        ['bill_id', 'label', 'title', 'congress_url', 'introduced_date', 'policy_area', 'legislative_subjects',
         'sponsor_bioguide', 'sponsor_name', 'reporting_committees', 'committee_system_codes', 'seed_issue_ids',
         'issue_mapping_method', 'status', 'latest_action_date', 'latest_action_text', 'report_citations'], rows)

    # ---- issues.csv --------------------------------------------------------------------------------------------
    n_bills = collections.Counter(i for r in bill_issues.values() for i in r['issues'])
    rows = [[i['id'], i['name'], i['parent'], i['parent'][:4], n_bills.get(i['id'], 0)] for i in issues]
    counts['issues.csv'] = write_csv(out / 'issues.csv',
        ['issue_id', 'name', 'parent_subcommittee_id', 'committee_id', 'n_bills'], rows)

    # ---- bill_committees.csv -----------------------------------------------------------------------------------
    rows = [[r['bill_id'], r['domain_id'], domains.get(r['domain_id'], {}).get('label', ''),
             domains.get(r['domain_id'], {}).get('taxonomy', ''), r['linkage'], r['extraction_method'], r['source_id']]
            for r in bill_domain]
    counts['bill_committees.csv'] = write_csv(out / 'bill_committees.csv',
        ['bill_id', 'domain_id', 'domain_name', 'taxonomy', 'linkage', 'extraction_method', 'source_id'], rows)

    # ---- committee_seats.csv -----------------------------------------------------------------------------------
    rows = []
    for s in jl(src / 'person_committee.jsonl'):
        name, party, state, _ = pname(s['bioguide'])
        rows.append([s['bioguide'], name, party, state, s['committee_code'], cname(s['committee_code']),
                     s.get('role') or '', s.get('rank') or '', s.get('party') or ''])
    counts['committee_seats.csv'] = write_csv(out / 'committee_seats.csv',
        ['bioguide_id', 'name', 'party', 'state', 'committee_code', 'committee_name', 'role', 'rank', 'side'], rows)

    # ---- committees.csv ----------------------------------------------------------------------------------------
    rows = [[d['domain_id'], d['label'], d['domain_id'].lower() if d['domain_id'].startswith('HS') else '', d.get('in_graph', '')]
            for d in domains.values() if d['taxonomy'] == 'house_committee']
    counts['committees.csv'] = write_csv(out / 'committees.csv',
        ['committee_code', 'committee_name', 'web_taxonomy_id', 'in_graph'], rows)

    # ---- reports.csv -------------------------------------------------------------------------------------------
    rec_kinds = collections.defaultdict(collections.Counter)
    for ix in index:
        rec_kinds[ix['source_record_id'].split(':')[0]][ix['kind']] += 1
    votes_status = {}
    for r in internal_recs:
        if r['section_type'] == 'committee_votes':
            votes_status.setdefault(r['source_id'], set()).add(r['parse_status'])
    skip = getattr(__import__('m1.build', fromlist=['SKIP_PKGS']), 'SKIP_PKGS', {})
    rows = []
    for sid, s in sorted(((k, v) for k, v in sources.items() if v['source_type'] == 'committee_report'),
                         key=lambda kv: fetch.natural_key(kv[0])):
        has_text = (src / 'text' / f'{sid}.txt').exists()
        pkg = s.get('package_id') or sid
        reason = ('rules committee report, metadata only' if s['committee_code'] == 'HSRU'
                  else skip.get(pkg) or skip.get(sid) or '' if (pkg in skip or sid in skip)
                  else '' if has_text
                  else 'no bill: metadata only' if not s['bill_ids']
                  else 'govinfo has published neither the html edition nor the PDF yet' if not s.get('text_source')
                  else 'text available but nothing parsed')
        rows.append([sid, pkg, s.get('part_name') or '', s['citation'], s['title'], s['date'], s['committee_code'],
                     cname(s['committee_code']), s['bill_ids'], s['url_html'], s['url_pdf'], s.get('text_source') or '',
                     'yes' if has_text else 'no', reason,
                     rec_kinds[sid].get('views', 0), rec_kinds[sid].get('committee_votes', 0),
                     sorted(votes_status.get(sid, []))])
    counts['reports.csv'] = write_csv(out / 'reports.csv',
        ['source_id', 'package_id', 'part_name', 'citation', 'title', 'date', 'committee_code', 'committee_name', 'bill_ids',
         'url_html', 'url_pdf', 'text_source', 'text_parsed', 'not_parsed_reason', 'n_views_records', 'n_vote_records',
         'vote_table_parse_status'], rows)

    # ---- README + MANIFEST -------------------------------------------------------------------------------------
    (out / 'README.md').write_text(README.format(today=today, **{k.replace('.csv', ''): v for k, v in counts.items()}))
    man = []
    for f in sorted(x for x in out.glob('*.csv') if x.name != 'MANIFEST.csv') + [out / 'README.md']:   # no self row
        data = f.read_bytes()
        n = counts.get(f.name, '')
        man.append([f.name, n, len(data), hashlib.sha256(data).hexdigest()])
    write_csv(out / 'MANIFEST.csv', ['file', 'rows', 'bytes', 'sha256'], man)
    for k, v in counts.items():
        print(f'{k:22} {v:>7,} rows')
    print('->', out)


README = """# OWL ingest — CSV handoff ({today})

Everything module 1 (ingest) extracted from the 119th-Congress House committee reports, as flat tables.
Source of truth for every row is an official document: govinfo (reports, html edition), congress.gov BILLSTATUS
bulk XML (bills, sponsors, cosponsors), unitedstates/congress-legislators (members, committee seats). No model
was used anywhere in these files; every `extraction_method` is `metadata` (from structured data) or `rule`
(parsed from report text with a deterministic rule).

Conventions: UTF-8, LF line ends, RFC 4180 quoting (fields may contain newlines, always quoted), one header row,
empty cell = unknown or not applicable, multi-valued cells joined with `|`, dates `yyyy-mm-dd`, people are bioguide
ids (`H001068`), bills are `hr1382-119`-style ids, committees are the congress.gov system codes without the trailing
`00` (`HSPW`; `committees.csv` maps them to the web team's lowercase taxonomy ids).

## records.csv — {records} rows. The text the model reads (and the text quotes are checked against)
One row per text record. `kind` = `views` (a chunk of a minority / dissenting / additional / supplemental views
section, signed by the members in `person_bioguides`; this is the only place a named member speaks in a report)
or `committee_votes` (the printed roll-call table transcribed as one `Name: yea|nay` line per member; not speech,
kept so vote facts can cite a verifiable line). `content` is verbatim text; for views it starts with one speaker
tag `<Rep. A, Rep. B, ...>: ` listing every signer, for votes with `<other>: `. `part`/`parts` = chunk k of n of
one section. `parse_status` is the vote-table parser's status for vote records. `n_tokens_est` = len/4.

## evidence.csv — {evidence} rows. Every person x bill fact, with provenance
`action`: `sponsored`, `cosponsored` (from BILLSTATUS), `committee_vote` (`vote` = yea|nay|present|not_voting,
`vote_question` = the printed question with the rules boilerplate removed, up to 600 chars; `vote_kind` = what the
roll call decided, read from that text by rule: `final_passage` (ordered reported / motion to report / final passage),
`amendment`, `procedural`, `unknown`), `signed_views` (`views_type` = minority |
dissenting | additional | supplemental), `offered_amendment`. `stance_toward_bill` is a deterministic reading of
the action toward the bill: sponsor/cosponsor/yea = `for`, nay = `against`, minority/dissenting views = `against`
(inverted to `for` on the 7 adverse reports, where the majority voted the measure down), additional views and
amendments = `unknown`, present/not voting = `neutral`. It is a heuristic for views (a ranking member sometimes signs
minority views on a bill she sponsored); the authoritative stance for views text comes from the model reading
`records.csv`. `record_id` links to `records.csv` where the fact was parsed from a text record that is exported (blank for metadata rows and for the ~670 rows whose section yielded no exported record, e.g. amendments noted in a vote section that has no per-member tally); `quote_line` is the
exact line (`Mr. Neal: yea`, or a signature name) and is a verbatim substring of that record's `content` for all
yea/nay votes. `event_date` is the vote or filing date, clamped to the 119th Congress. `confidence` is 1.0 for every
row (no model). Rows from vote tables whose printed totals did not reconcile carry `parse_status = checksum_failed`
on the matching record; treat those with care.

## people.csv — {people} rows
Every House member with a 119th-Congress term: {people} = sitting today + those who left during the 119th
(`status`, `left_date`). `since` = first year in any congressional office. `committee_codes` = current seats.

## bills.csv — {bills} rows
Every bill a parsed report accompanies. `policy_area` is the one CRS term per bill; `legislative_subjects` the CRS
subject terms; `reporting_committees` the committee(s) that filed the report; `committee_system_codes` every
referral; `seed_issue_ids` the level-3 issues assigned from subjects, best match first (at most two; the first is the
primary issue; `issue_mapping_method` = subjects | title | unmapped); `status` = introduced | committee | passed_house |
passed_senate | enacted | failed | unknown, read by rule from `latest_action_text` (BILLSTATUS); `report_citations` the
H. Rept. numbers.

## issues.csv — {issues} rows
Seed level-3 issues (name, parent subcommittee id in the web team's taxonomy, committee, number of bills mapped).
Built from bill metadata only; the model may propose more.

## bill_committees.csv — {bill_committees} rows
Bill -> committee (`taxonomy = house_committee`, `linkage = super_high` when it filed the report, `high` for other
referrals) and bill -> CRS policy area (`taxonomy = crs_policy_area`).

## committee_seats.csv — {committee_seats} rows
Current committee membership from congress-legislators: `role` (chair, ranking member, member), `rank`, `side`.

## committees.csv — {committees} rows
Committee code -> name -> web taxonomy id (`hspw`); `in_graph` = false for Rules, Ethics, House Administration.

## reports.csv — {reports} rows
One row per House report of the 119th (one row per part for the 18 multi-part reports, `source_id` = `package_id`
+ `-ptN`, `part_name` = GPO's "Book 1"): what it accompanies, where the text is (`url_html`, `url_pdf`), which
rendition we parsed (`text_source` = `html`, the GPO text edition, or `pdf` through pdftotext when GPO has not
published the html edition yet), whether we parsed it (`text_parsed`, `not_parsed_reason`), how many records it
yielded, and the vote-table parser status (`ok`, `checksum_failed`, `narrative` = totals only, `voice_vote`,
`summary_only`, `graphic_only` = tally printed as an image, PDF only).

## Ids are stable across weekly reruns
`record_id` is built from the report, the section and its ordinal; `evidence_id` is a hash of the fact (person, bill,
action, source, vote, question, date, quoted line). Adding next week's reports does not renumber anything, so a
consumer can diff two drops on these columns. `CHANGES.md` and `delta/` next to this file list what is new since the
previous drop.

## Known limits
- Reports whose text GPO has not published yet are listed in `reports.csv` with `text_parsed = no`; the weekly run
  retries them.
- Six committees print vote tallies as images (`graphic_only`): no per-member votes from them.
- Signed views are almost all Democratic (the side that lost in committee writes them): 97 D and 1 R signers.
  Votes, sponsorships and cosponsorships cover both parties (432 of 439 sitting members).
- `vote_question` is capped at 600 characters; `vote_kind` is a rule over its text, check `unknown` rows before trusting it.
"""


if __name__ == '__main__':
    main()
