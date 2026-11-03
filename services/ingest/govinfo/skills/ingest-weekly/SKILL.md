---
name: ingest-weekly
description: Run the OWL weekly ingest - check govinfo for new U.S. House committee reports, download and parse them with the deterministic pipeline, and report what the CSV drop for services/process gained. Use when the user says "weekly ingest", "check govinfo for new reports", "ingest run", "refresh the committee reports", or asks whether there are new reports.
allowed-tools: Bash(python3:*), Bash(git:*), Bash(ls:*), Bash(cat:*), Bash(head:*), Bash(tail:*)
license: MIT
compatibility: Needs python3, curl, node >= 18; pdftotext (poppler) only for the PDF fallback.
metadata:
  author: owl ingest (Hank)
  version: "1.1"
---

Weekly ingest for OWL module 1. The pipeline is a program, not you: never read a report yourself, never extract
anything with the model. Your job is to run it, read its `RESULT:` line, and report.

1. Work in the ingest directory (`services/ingest/govinfo/` in the repo, or `module1/` during development): it holds
   `ingest.py` and `AGENTS.md`. Read `AGENTS.md` first if you have not. (`services/ingest/csv-to-json.mjs`, one level
   up, is Ben's converter that consumes the drop; the build runs it as its validation gate.)
2. Run `python3 -I ingest.py run --publish <repo>/data/ingest` (the agreed drop location; inside the repo that is
   `../../../data/ingest`; omit `--publish` when the directory is not inside the OWL repo). It refreshes the member roster
   (monthly) and the govinfo sitemaps, downloads the text of new reports
   (html edition first, PDF through pdftotext when the html edition is not out yet), re-downloads bill status for
   reports of the last 45 days, and rebuilds (~10 min) only when something changed. Wait for it; do not run steps
   by hand in parallel.
3. Read the last line, `RESULT: {...}`:
   - `"changed": false` -> tell the user nothing new was published since the last run (give `check.textless` count).
   - `"changed": true` -> summarise `check.new` (report id, date, committee, bill, title), `fetch.newly_texted`,
     `build.rows` and `build.added`, and point to `out_full/csv/CHANGES.md` (it lists newly parsed reports and the
     row counts added per table; `out_full/csv/delta/` holds only the added rows).
   - `"ok": false` -> open the log named in `log`, quote the failing step. Network failures: rerun once. A parser
     exception on one report: report the report id and the traceback; do not patch parsing rules without the user.
4. Sanity checks before you call it done: `build.validated_records` equals `rows["records.csv"]` (every record passes
   the contract validator) and `build.converter.statements` is present (the drop went through `csv-to-json.mjs`); `state/last_run.json` exists; `git status --short` shows no `cache/`, `out_full/` or
   `state/runs/` files staged.
5. Only if the user asked to ship: branch `data/ingest-<yyyy-mm-dd>`, run `python3 -I ingest.py build --publish
   <repo>/data/ingest` (idempotent), `git add data/ingest state/packages.json state/handoff_keys.json`, commit via
   the shell with the Muse Code trailer, then stop. Pushing and PRs happen in the user's shell.
