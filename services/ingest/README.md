# services/ingest

Deterministic ingest: CSV drop → contract-A records + contract-B data files.
No model calls, no network. Same input → same bytes out.

## csv-to-json.mjs

```bash
node services/ingest/csv-to-json.mjs <csv-dir> <out-dir> [--records <dir>] [--drop <label>] [--skip-manifest]
# e.g.
node services/ingest/csv-to-json.mjs owl-ingest-csv-2026-10-30 data
```

Verifies `MANIFEST.csv` sha256 first (refuses on mismatch unless
`--skip-manifest`), then writes `taxonomy/issues/people/stances.json` to
`<out-dir>` and one record JSON per row to `<out-dir>/records`
(`summaries.json` / `conditions.json` are LLM-owned and not emitted).

Mapping:

| CSV | JSON | rule |
|---|---|---|
| people.csv | people.json | `id` = bioguide; sitting + departed |
| committees.csv + issue parents | taxonomy.json | `in_graph=false` committees dropped unless an issue needs them; subcommittee names are provisional title-cased slugs (the drop carries ids only) |
| issues.csv | issues.json | direct |
| bills.csv | bills.json | one record per bill: number, title, best-effort status, last action, sponsor, all seed issues |
| records.csv | records/*.json | content verbatim; gov/usgov/official_transcript |
| evidence sponsored/cosponsored | stances ±1.0/0.8, kind sponsored/cosponsored | one row on the bill's primary issue; anchored to synthetic per-(bill, date) `rec-billstatus-*` transcriptions of BILLSTATUS data |
| evidence committee_vote yea/nay | stances ±0.8, kind vote | quote = the record's own vote line; `vote_question` (final_passage/amendment/procedural) when recognised, omitted when boilerplate/unknown |
| evidence committee_vote present | stances 0.0, kind vote | neutral; a cast vote still counts as a row |
| evidence committee_vote not_voting | skipped | absence is not a stance |
| evidence signed_views | skipped | signatures track party membership, not issue opposition |
| evidence offered_amendment | skipped | no exported record to anchor a quote |

Rows whose bill has no seed issues, whose quote line is not found in the
record, or that duplicate an identical statement are skipped and counted in
the printed report. Statements from `checksum_failed` records get confidence
downgraded one notch. Statement dates always equal the record's `hints.date`
(the contract's rule), so validation reports no date warnings.

The process stage should skip `rec-billstatus-*` records: their facts are
already in `stances.json` (see `services/process/extract-batch.mjs`, which
excludes them by default).

## Tests

```bash
node --test services/ingest/csv-to-json.test.mjs
```

Zero-dependency (`node:test`); covers the CSV parser, committee-name
shortening, and quote resolution (speaker-tag substring, `not_voting`
record line, backtick repair, unresolvable → null).

See docs/ARCHITECTURE.md for the contract this service consumes/produces.
