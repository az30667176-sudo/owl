# OWL ingest — CSV handoff (2026-11-03)

Everything module 1 (ingest) extracted from the 119th-Congress House committee reports, as flat tables.
Source of truth for every row is an official document: govinfo (reports, html edition), congress.gov BILLSTATUS
bulk XML (bills, sponsors, cosponsors), unitedstates/congress-legislators (members, committee seats). No model
was used anywhere in these files; every `extraction_method` is `metadata` (from structured data) or `rule`
(parsed from report text with a deterministic rule).

Conventions: UTF-8, LF line ends, RFC 4180 quoting (fields may contain newlines, always quoted), one header row,
empty cell = unknown or not applicable, multi-valued cells joined with `|`, dates `yyyy-mm-dd`, people are bioguide
ids (`H001068`), bills are `hr1382-119`-style ids, committees are the congress.gov system codes without the trailing
`00` (`HSPW`; `committees.csv` maps them to the web team's lowercase taxonomy ids).

## records.csv — 768 rows. The text the model reads (and the text quotes are checked against)
One row per text record. `kind` = `views` (a chunk of a minority / dissenting / additional / supplemental views
section, signed by the members in `person_bioguides`; this is the only place a named member speaks in a report)
or `committee_votes` (the printed roll-call table transcribed as one `Name: yea|nay` line per member; not speech,
kept so vote facts can cite a verifiable line). `content` is verbatim text; for views it starts with one speaker
tag `<Rep. A, Rep. B, ...>: ` listing every signer, for votes with `<other>: `. `part`/`parts` = chunk k of n of
one section. `parse_status` is the vote-table parser's status for vote records. `n_tokens_est` = len/4.

## evidence.csv — 20636 rows. Every person x bill fact, with provenance
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

## people.csv — 451 rows
Every House member with a 119th-Congress term: 451 = sitting today + those who left during the 119th
(`status`, `left_date`). `since` = first year in any congressional office. `committee_codes` = current seats.

## bills.csv — 785 rows
Every bill a parsed report accompanies. `policy_area` is the one CRS term per bill; `legislative_subjects` the CRS
subject terms; `reporting_committees` the committee(s) that filed the report; `committee_system_codes` every
referral; `seed_issue_ids` the level-3 issues assigned from subjects, best match first (at most two; the first is the
primary issue; `issue_mapping_method` = subjects | title | unmapped); `status` = introduced | committee | passed_house |
passed_senate | enacted | failed | unknown, read by rule from `latest_action_text` (BILLSTATUS); `report_citations` the
H. Rept. numbers.

## issues.csv — 86 rows
Seed level-3 issues (name, parent subcommittee id in the web team's taxonomy, committee, number of bills mapped).
Built from bill metadata only; the model may propose more.

## bill_committees.csv — 1695 rows
Bill -> committee (`taxonomy = house_committee`, `linkage = super_high` when it filed the report, `high` for other
referrals) and bill -> CRS policy area (`taxonomy = crs_policy_area`).

## committee_seats.csv — 872 rows
Current committee membership from congress-legislators: `role` (chair, ranking member, member), `rank`, `side`.

## committees.csv — 23 rows
Committee code -> name -> web taxonomy id (`hspw`); `in_graph` = false for Rules, Ethics, House Administration.

## reports.csv — 813 rows
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
