# OWL ingest, govinfo stage (services/ingest/govinfo) — rules for coding agents

This directory is module 1 of OWL (Open Watch on Legislators): it turns U.S. House committee reports of the 119th
Congress (govinfo) into evidence tables, **without any model**. The team's Muse Spark stage (`services/process`,
Ben) reads our CSV drop and extracts stances. Repo-wide rules live in the repo root `AGENTS.md` and
`openspec/config.yaml`; this file adds the ingest-specific ones.

## The one command

```
python3 -I ingest.py run                 # weekly: check govinfo -> fetch new text -> rebuild only if something changed
python3 -I ingest.py check               # just look: new / changed / text-less reports (updates state/packages.json)
python3 -I ingest.py fetch               # download text (html edition, else PDF via pdftotext) + bill status the cache lacks
python3 -I ingest.py build [--publish DIR]   # offline rebuild (~10 min) -> out_full/, CSV drop in out_full/csv/ (+ CHANGES.md, delta/)
python3 -I ingest.py backfill            # one-off: every report of the Congress, then build
python3 -I ingest.py status              # last run, counts, what is still without text
```

Every command ends with one line `RESULT: {json}` (read it; `"ok": false` carries `error` and the log path) and
logs to `state/runs/`. Exit 0 also when nothing is new. Always run Python as `python3 -I`.

## How the pipeline works (do not re-implement any of it with a model)

1. `m1/fetch.py` reads govinfo's CRPT sitemaps (which reports exist), each report's MODS record (title, date,
   committee, bills, **the real file URLs**: 77 of 852 reports are named `<pkg>-pt1.htm`, 18 have several parts),
   the html edition of the text (GPO's fixed-width text), the PDF only when the html edition is not out yet
   (`pdftotext -layout` + `parse.load_pdf_text`), and bulk BILLSTATUS xml for bills. Everything is cached in `cache/`;
   re-runs are offline.
2. `m1/parse.py` + `m1/build.py` split a report into sections and extract, by rule only: sponsor, amendments offered,
   per-member committee votes (checksummed against printed totals), signers of minority/additional/dissenting views
   (the text itself is left to the model), one purpose record. Known rules that bit us: legislative-history dates are
   clamped to the 119th; ADVERSE reports flip the views stance; H. Rept. 119-59 is skipped (`SKIP_PKGS`).
3. `m1/export_owl.py` writes contract-A records + `people.json`, `m1/seed_issues.py` the seed `issues.json`,
   `m1/flip_scan.py` a no-model flip report, `m1/export_csv.py` the **CSV drop** Ben consumes (`out_full/csv/`:
   records, evidence, people, bills, issues, bill_committees, committee_seats, committees, reports + README/MANIFEST).
   `ingest.py build` adds `CHANGES.md` and `delta/` (rows new since the previous drop) and runs the repo validator
   (`packages/contract/validate.mjs`) on every record.

Ids are stable across reruns (`record_id` from report/section/ordinal, `evidence_id` a hash of the fact); never
renumber them.

## Hard rules

- No model call anywhere in this directory. Parsing is deterministic; if a report parses badly, fix the rule in
  `m1/parse.py` / `m1/build.py`, rerun `ingest.py build`, and check `out_full/pilot_report.md` and
  `out_full/owl/flip_report.md` for regressions.
- Network only to govinfo.gov (key-free) in `check` / `fetch` / `backfill`. `build` is offline.
- Never commit `cache/`, `out/`, `out_full/`, `state/runs/` (see `.gitignore`). The CSV drop goes to the repo through
  `ingest.py build --publish <repo>/data/ingest` (or whatever directory the team agrees), never by hand-copying.
- Never print or commit API keys. This module needs none; the repo's `.env` holds `MODEL_API_KEY` for Ben's stage.
- Quotes stay verbatim: `content` in records is the report text as published, only de-indented and unwrapped.
- Decisions in force (Oct 30): the drop is published to `<repo>/data/ingest/` only; the weekly job is the GitHub Actions
  cron `.github/workflows/ingest-weekly.yml` (source copy: `tools/github-workflow-ingest-weekly.yml`), operated by Muse
  Code on the runner with `muse-spark-1.3-contributor`; its PRs are `data: weekly ingest drop <date>`.
- Since Nov 2: this directory lands at `services/ingest/govinfo/`; `services/ingest/csv-to-json.mjs` (Ben) is the
  consumer of the drop and `ingest.py build` runs it, then the repo validator, as its gate (output in
  `state/staging/`, git-ignored). Column names and file names of the drop are therefore load-bearing for his code.
- `extraction_method` must stay `metadata` | `rule`: Ben's converter writes it into each statement's `model` as
  `owl-ingest-<method>`, and Kurt's web (`apps/web/lib/derive.mjs kindOf`) reads exactly those two values to label a
  statement sponsored / cosponsored / yea / nay / not voting / signed views. `stance_toward_bill` and `vote` drive the
  score sign the same way.
- `vote_kind` (evidence.csv) and `status` (bills.csv), added Nov 2 for owl #25/#26/#28, are rule-derived and
  documented in the drop README; keep their enums stable.
- A change to any output column or file name is a contract change for Ben: open a GitHub issue labelled `contract`
  and `area:ingest` first (see `docs/WORKFLOW.md`).

## Working here

- Dependencies: Python 3.12 (`pip install pyyaml`), `curl`, `node >= 18` (validator), `pdftotext` (poppler; only
  for the PDF fallback). No virtualenv needed.
- Quick test after a parser change: `python3 -I run_pilot.py CRPT-119hrpt852 CRPT-119hrpt4 CRPT-119hrpt106` writes
  the sample to `out/` in a few seconds; `python3 -I run_pilot.py --all` is the ~10 min full build.
- Commits: run `git commit` yourself through the shell so the repo's `user.name`/`user.email` are the author; subject
  prefixed `ingest:`; trailer `Co-Authored-By: Muse Code <noreply@meta.com>` (Claude Code on Anthropic:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`). Do not push or open a PR unless asked in the session.
- Anything beyond a one-line fix starts as an OpenSpec change ("openspec propose ..."), per the repo README.
- `NEXT.md` is the running to-do for this directory; update it when you finish or start an item.
