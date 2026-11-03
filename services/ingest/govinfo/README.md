# Module 1 — data source + pre-processing (House committee reports, 119th Congress)

Produces LLM-ingestible records plus ERD rows that need no model, and the CSV drop that Ben's
`services/ingest/csv-to-json.mjs` converts to contract A/B JSON (contracts: `packages/contract/README.md`).
Everything is key-free (govinfo sitemaps, MODS metadata, bulk BILLSTATUS XML, unitedstates/congress-legislators).
No model is called anywhere in this module.

## Run (Oct 30: one command, made to be run by an agent on a schedule)

```
pip install pyyaml                       # plus curl, node >= 18 (repo validator), pdftotext (poppler; PDF fallback only)
python3 -I ingest.py run                 # WEEKLY: refresh govinfo sitemaps -> fetch new report text + bill status -> rebuild only if something changed
python3 -I ingest.py backfill            # ONE-OFF: every report of the 119th (sitemaps, MODS, text, bills; ~15 min of downloads), then build
python3 -I ingest.py build --publish ../owl/data/ingest   # offline rebuild (0.7 min) -> out_full/ + CSV drop (CHANGES.md, delta/) copied to DIR
python3 -I ingest.py check | fetch | status               # the pieces of `run`, and a status line
```

`build` ends by converting the drop with Ben's `services/ingest/csv-to-json.mjs` (when the repo is found next to this
directory or above it) and running `packages/contract/validate.mjs` over the result, so what is published is exactly what
the process stage can consume. Every command ends with one line `RESULT: {json}` and logs to `state/runs/`; `state/packages.json` remembers every
report seen, `state/handoff_keys.json` the ids of the last drop (for `CHANGES.md` / `delta/`). `check` also refreshes
the member roster (unitedstates/congress-legislators) when it is older than 30 days. `AGENTS.md` holds the rules for
coding agents, `skills/ingest-weekly/SKILL.md` is the Muse Code skill ("run the weekly ingest"; the launcher copies it
into `.agents/skills/`, which the repo ignores),
`tools/ingest-weekly.sh` the scheduler entry point (Muse Code headless on `muse-spark-1.3-contributor`, or `--direct`
without an agent), `tools/github-workflow-ingest-weekly.yml` the GitHub Actions cron that runs it on Mondays and opens
a `data: weekly ingest drop <date>` pull request through `tools/ci-open-drop-pr.sh` (decided Oct 30).

Under the hood (what `ingest.py` calls; offline from `cache/` after the first download):

```
python3 -I m1/fetch.py sitemaps [--force] # report ids + lastmod (852 in the 119th on Oct 30 2026)
python3 -I m1/fetch.py mods-all           # metadata for every report, ~7 min the first time
python3 -I m1/fetch.py text ID [ID...]    # report text: html edition, else PDF -> pdftotext
python3 -I m1/fetch.py roster [--force]   # members + committee seats; refreshed when older than 30 days
python3 -I run_pilot.py                   # 20-report sample across the CA-heavy committees -> out/
python3 -I run_pilot.py --all             # every non-Rules report -> out_full/ (0.2 min)
python3 -I run_pilot.py CRPT-119hrpt852 CRPT-119hrpt4     # explicit ids
python3 -I m1/export_owl.py [--state XX]  # out_full/ -> out_full/owl/: contract-A records + people.json (national; --state is a debug filter)
python3 -I m1/seed_issues.py ; python3 -I m1/flip_scan.py ; python3 -I m1/export_csv.py
```

`cache/` holds every download (git-ignored); re-runs are offline. Note: python's urllib has no CA bundle on
this Mac, so `fetch.py` shells out to `curl`.

## How govinfo publishes, and what the weekly check relies on (checked Oct 30 2026)

- `https://www.govinfo.gov/sitemap/CRPT_<year>_sitemap.xml` lists every report package with a `lastmod`; `check`
  re-downloads it and treats unknown ids as new reports, newer `lastmod` as changed packages.
- Each package's MODS record (`/metadata/pkg/<pkg>/mods.xml`) carries title, date, committee, bills, and **the real
  file URLs**. 77 of the 852 packages name their files `<pkg>-pt1.htm` / `.pdf`, 18 of them have 2-4 parts ("Book 1",
  "Book 2"; `source_id` = `<pkg>-ptN`, each part parsed as its own source with its own committee). Guessing
  `<pkg>.htm` is what left 84 reports "text-less" until Oct 30.
- The html edition (GPO's fixed-width text, what the parser was written for) was published together with the PDF for
  all 810 report parts of the 119th. The PDF path (`pdftotext -layout` + `parse.load_pdf_text`) is the fallback for the
  day it is not: on H. Rept. 119-852 it finds the same sections and 65 of 66 vote rows (a name with a diacritic is
  lost); views text through it is untested.
- A missing file is answered with HTTP 200 and a 44 kB "Page Not Found" page; `fetch.get` detects it.
- Ids are stable across reruns: `record_id` from report part, section and ordinal; `evidence_id` a hash of the fact.

## Outputs (JSONL, one object per line)

| file | one row per | notes |
|---|---|---|
| `records.jsonl` | report section, roll call, or views chunk | `text` = header (`[DOCUMENT]`, `[BILL]`, `[MEMBERS]` with bioguide ids, `[SECTION]`) + normalised body; `needs_llm`, `parse_status`, `split` |
| `person_bill.jsonl` | evidence row (person, bill, action, source) | gold rows; `extraction_method` metadata/rule, `confidence` 1.0; `fact_key` groups duplicates across sources |
| `bill_domain.jsonl` | (bill, committee or CRS policy area) | reporting committee + policy area = super_high, other referrals = high |
| `bills.jsonl`, `persons.jsonl`, `sources.jsonl`, `domains.jsonl`, `person_committee.jsonl` | entity tables | persons = every House member with a 119th term (451), current or departed |
| `sft.jsonl` | chat-format training example | user = `record.text`, assistant = gold rows for that record; `split` by bill |
| `splits.json`, `text/<pkg>.txt`, `pilot_report.md` | | |

## What the parser handles (pilot: 20 reports, 17 committees)

| section | extracted without a model | status values |
|---|---|---|
| legislative history | sponsor sentence (cross-checked with BILLSTATUS), amendments offered by name | `ok`, `unresolved_names` |
| committee votes, dot-leader tables (Transportation, Natural Resources) | per-member vote, checksum against printed totals | `ok`, `checksum_failed`, `rows_missed` |
| committee votes, column tables with x marks (Armed Services, Ways and Means) | per-member vote from column order | same |
| committee votes, narrative (Budget, Judiciary, Financial Services) | amendments by name; totals only | `narrative`, `voice_vote`, `summary_only` |
| committee votes printed as images (Energy and Commerce, Homeland, Small Business, Veterans, Science, Education) | nothing: tallies are only in the PDF | `graphic_only` |
| minority / additional / dissenting views | signers from the signature block -> `signed_views`; stance and quote left to the LLM | `ok`, `no_signatures` |
| purpose / summary | one capped context record per report | `ok` |

`needs_llm` is true only for views chunks: 14 of 115 pilot records, ~29k of 130k tokens.

Full run (Oct 28): 790 non-Rules reports, 713 with html text, 782 bills -> 2,549 records (1,809,943 tokens est.), 19,757 evidence rows ({'sponsored': 1097, 'offered_amendment': 359, 'signed_views': 1083, 'cosponsored': 8300, 'committee_vote': 8918}), 2,109 rows for CA members, 867 SFT examples. LLM phase: 425 views chunks / 793,250 tokens; only those signed by a CA member: 248 chunks / 512,493 tokens. 51 of 52 current CA members have rows (median 25); fewest: Luz M. Rivas 2, Nancy Pelosi 2, James Gallagher 2, Pete Aguilar 1; none: Aisha Wahab.

Full run (Oct 30, after the `-pt1` URL fix and the compilation-report fix): 810 report parts, all with text -> 2,967 records (2,476,488 tokens est.), 20,546 evidence rows ({'sponsored': 1148, 'offered_amendment': 526, 'signed_views': 1257, 'cosponsored': 8300, 'committee_vote': 9315}). LLM phase: 600 views chunks / 1,280,081 tokens. Build time 0.7 min offline.

Full run (Nov 3, after the vote-question boilerplate strip): same 810 parts -> 20,636 evidence rows
({'sponsored': 1153, 'offered_amendment': 527, 'signed_views': 1257, 'cosponsored': 8317, 'committee_vote': 9382};
BILLSTATUS refresh added cosponsorships). Every `committee_vote` row carries `vote_kind`
(final_passage 2,894 / amendment 6,038 / procedural 450 / unknown 0). Converter gate on this drop
(`csv-to-json.mjs` + `validate.mjs`): 17,423 statements, 785 bills, 0 errors.

## Export for the team repo (`az30667176-sudo/owl`, contract in `packages/contract/README.md`)

`m1/export_owl.py` turns the views chunks into contract-A records (`out_full/owl/records/<id>.json`, one file per
chunk, `content` = one speaker tag listing every signer + the verbatim section text, `hints.persons` = signer
bioguide ids, `hints.bill_urls` = congress.gov links, provenance under `_meta.ingest`) and writes a contract-B
`people.json` (every sitting House member, `id` = bioguide id). Oct 30: 587 views records from 355 signed views sections
across 810 report parts (H. Rept. 119-59 excluded; 7 sections had no resolvable signer), ~1.15M tokens, 586 signed by at
least one Democrat and 1 by a Republican (John Rose, H. Rept. 119-561), 130 distinct signers; 451 people (439 sitting + 12 who left during the 119th).
Scope is the whole House. Check with the repo's validator (`ingest.py build` does it):

```
node ../owl/packages/contract/validate.mjs $(printf -- '--record %s ' out_full/owl/records/*.json)   # OK, 0 warnings
```

Vote sections with per-member tallies are also exported as contract-A records (`*-committee-votes-*`, 181 records, one
`Name: yea|nay` line per member under an `<other>:` tag) so vote-derived stance rows can carry a verifiable `quote`; they
are not meant for the model. Votes, sponsors and cosponsors reach contract B through `csv-to-json.mjs`, which emits them
as statement rows with `kind` (`vote` / `sponsored` / `cosponsored`); `signed_views` and `not_voting` rows are skipped
there by design (#26). The fine-tuning file `sft.jsonl` is not used by the repo's prompt-based process stage; it remains an eval set.

## Known gaps (as of Oct 30 2026)

- Signed views are one-sided by nature (the side that lost in committee writes them): 586 of 587 views records carry a
  Democratic signer, 1 a Republican. Votes, sponsorships and cosponsorships cover both parties.
- Compilation reports: H. Rept. 119-59 (oversight plans) is excluded; the two reconciliation books (H. Rept. 119-106)
  are parsed, with views cut at the next committee's transmittal letter (`parse.next_document_start`). 31 non-name
  strings ("Secretary", "Congressional Budget Office") still reach the signature parser there; they resolve to nobody
  and yield no rows, but `_name_line` could be tightened. Name resolution prefers a first-name match in a wider pool over
  a last-name-only match in the committee pool ("Troy A. Carter" in a Budget pool holding only Buddy Carter).
- Foreign Affairs has filed no reports in the 119th; Armed Services 3, Science 5, Budget 3, Agriculture 3. Floor roll
  calls and cosponsorship (congress.gov / clerk.house.gov, no model) are the fill-in for those members.
- Rules Committee reports (62) are not parsed; bill-less reports (8, e.g. contempt resolutions) yield metadata only.
- Image-only vote tallies (six committees, `graphic_only`) need OCR of the PDF; out of scope. 8 vote tables fail the
  printed-total checksum (`checksum_failed`; the converter downgrades their confidence). `vote_question` carries the
  real question (rules boilerplate stripped Nov 2, cap 600 chars) plus a rule-read `vote_kind` column.
- Report ids are pinned to the 119th Congress (`CRPT-119hrpt*`); the 120th (Jan 2027) needs a one-line change in
  `fetch.sitemap_entries` and new roster files.

## Seed issues and flip scan (Oct 29)

```
python3 -I m1/seed_issues.py     # out_full/owl/issues.json (86 level-3 issues, parent = Kurt's subcommittee ids) + bill_issues.jsonl + issues_report.md
python3 -I m1/flip_scan.py       # out_full/owl/flip_report.md: no-model flip candidates from person_bill x bill_issues
```

`seed_issues.py` holds a curated (committee, legislative subjects, policy area) -> issue map so Muse maps to existing ids
instead of proposing hundreds. `flip_scan.py` treats sponsor/cosponsor/yea-on-passage as `for`, nay-on-passage and
minority/dissenting views as `against` (inverted on ADVERSE reports), and lists same-person same-issue reversals. Cross-bill
candidates are real flips only when both bills point the same way, which is the Muse bill-direction step.

## Muse Spark pilot (Oct 29)

Kurt's `extract.mjs` run on 11 real records: `out_full/owl/muse_pilot.md` (findings and the three settings Ben needs to change:
`reasoning_effort: "low"`, `max_tokens: 12000`, fan-out for jointly signed records), raw outputs in `out_full/owl/muse_pilot/`,
tested patch `out_full/owl/extract_pilot.patch`. The Meta key is read from the repo `.env` (`MODEL_API_KEY`), never committed.

## CSV handoff (Oct 29)

```
python3 -I m1/export_csv.py      # out_full/csv/: 9 flat tables + README (data dictionary) + MANIFEST (rows, bytes, sha256)
```

For a consumer who prefers CSV and builds the JSON himself: `records.csv` (768 text records with verbatim `content`),
`evidence.csv` (20,636 person x bill facts with provenance, `quote_line` and `vote_kind`), `people.csv` (451, with `left_date`),
`bills.csv`, `issues.csv`, `bill_committees.csv`, `committee_seats.csv`, `committees.csv`, `reports.csv` (810 rows, one
per report part, with `text_source`). `ingest.py build` adds `CHANGES.md` (what changed since the previous drop) and
`delta/` (only the added rows) and copies the set to `--publish DIR`. Same data as the JSON handoff in `out_full/owl/`,
plus the fields the contract schemas forbid.
