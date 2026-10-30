# Tasks

## 1. Contract and mock ledger

- [x] 1.1 Create `packages/contract/conditions.schema.json` per the data-contract delta (top level `{ _meta?, demands[], conditions[] }`, enums, patterns, lengths, `statement_id` string|null, `bill` string|null).
- [x] 1.2 Extend `packages/contract/validate.mjs`: load `conditions.json` when present; schema-validate; unique demand ids; `excludes` ids exist; unique `condition_id`; `demand`, `person`, `issue` exist; non-null `statement_id` exists and matches person; verbatim quote vs record when supplied, else counted as skipped; conditions count in the summary line.
- [x] 1.3 Create `data/conditions.json` (`_meta.mock: true`) with demands `water-cap` (amendment), `water-disc` (amendment), `clean` (procedure, excludes both) and four rows from `data/records/record-hearing-mock.json`: Tsao p07 water-cap support vote; Raman p05 water-disc support final_passage; Beaumont p04 water-disc oppose vote; Beaumont p04 clean support vote. Quotes copied verbatim; issue `data-centers`; bill `H.R. 6110`; `statement_id: null`.
- [x] 1.4 Add the file to `packages/contract/README.md` (contract B table + `### conditions.json` section) and a row to `data/README.md`.
- [x] 1.5 `.github/workflows/pages.yml`: copy `data/conditions.json` into `_site/data/` when present.
- [x] 1.6 `node packages/contract/validate.mjs data --records data/records` prints OK with 4 conditions and quotes checked.

## 2. Explore and profile

- [x] 2.1 `apps/web/index.html` loader: optional `conditions.json` (same pattern as summaries); build `DEMANDS`, `CONDS`, lookups by person, by person|issue, by issue; bill id helper.
- [x] 2.2 Explore: ◆ marker at the midpoint of edges with conditions; stance-first tooltip; no change to existing edge styling.
- [x] 2.3 Explore side panel when an issue is selected: bills of that issue, each with its demand chips (name, type, wins/loses, stance-first lines, link to `#/bill/<id>`); hovering a chip highlights only matching edges.
- [x] 2.4 Profile: "Conditions" block between the AI summary and the tabs; hidden when empty.

## 3. Bill page

- [ ] 3.1 Route `#/bill/<id>` (hashchange + initial load), nav back to Explore.
- [ ] 3.2 Header, stance strip (support now / oppose now / conditions / silent), current-stance spectrum with ◆ on legislators who stated a condition.
- [ ] 3.3 Negotiation map per `data/_site/bill-page.html`: demand nodes, condition edges, toggles honouring `excludes`, YES/NO/UNKNOWN labels with "was …", who-moves list, deterministic read-across sentence, hover tooltips, click legislator → profile.

## 4. Verify and announce

- [ ] 4.1 Validator OK; local server: Explore ◆ + panel, profile block for Tsao/Raman/Beaumont, `#/bill/hr6110` toggles; temporarily rename `conditions.json` and confirm nothing breaks.
- [ ] 4.2 Commits by Muse Code with trailer `Co-Authored-By: Muse Code <noreply@meta.com>`; push; Pages run validates.
- [ ] 4.3 Open a GitHub issue labelled `contract` announcing `data/conditions.json` (shape, rules, how to validate, that the five existing files are unchanged).
