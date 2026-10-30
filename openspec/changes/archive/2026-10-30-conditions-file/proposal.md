# Proposal

## Why

Legislators rarely say a flat "yes" or "no" in hearings; they say "I am a no until this bill contains an enforceable water cap." A score of −0.8 hides the one thing a staffer, journalist or advocate wants to know: what would change their mind. In the mock hearing alone, three members state conflicting conditions on the same bill (a cap, a disclosure, nothing at all) and the current data model cannot represent any of them. A **conditions ledger** turns OWL from "where they stand" into "what it would take", a beyond-basic use of Muse Spark.

Contract: touches **B** by adding one new optional file. The five existing files are not modified in any way. A GitHub issue labelled `contract` announces the new file to the process team.

## What Changes

- New optional contract-B file `data/conditions.json` with two arrays:
  - `demands`: a registry of normalised demands (`id`, `name`, `type`, optional `excludes`), so the same demand on two bills is recognisably the same thing.
  - `conditions`: one row per condition a legislator states, carrying `demand`, `person`, `issue`, `bill`, `stance_if_met`, `scope` (vote or final passage), a one-sentence `condition`, a verbatim `quote`, optional `statement_id`, `record_id`, `model`.
- New JSON Schema `packages/contract/conditions.schema.json`; `validate.mjs` validates the file when present; README rows in `packages/contract/README.md` and `data/README.md`; Pages workflow copies the file when present.
- A mock ledger built by hand from the mock hearing record (quotes verbatim), so the UI is demonstrable now.
- Frontend (`apps/web/index.html`):
  - Explore: existing edge encoding unchanged; a ◆ marker on edges that carry a condition, with a stance-first what-if tooltip; clicking an issue lists its bills and their demand chips in the side panel; hovering a chip highlights only the edges it concerns.
  - New bill page `#/bill/<id>`: header, stance strip, current-stance spectrum, and a negotiation map with amendment toggles, mutually exclusive demands, YES/NO/UNKNOWN labels and a who-moves list.
  - Legislator profile: a "Conditions" block with stance-first sentences.
  - Clicking any legislator node opens their profile; node colour stays party-only.

Out of scope: any change to `services/` (no extractor, no edits to `extract.mjs`), any change to the five existing data files, a `bills.json` entity (later change).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-contract`: contract B gains an optional sixth file and the rules for it.
- `web-app`: Explore gains condition markers and the bill-grouped demand panel; a new bill page; profile gains a Conditions block; party/stance colour rule.

## Impact

- `packages/contract/`: new `conditions.schema.json`; `validate.mjs`; `README.md`.
- `data/`: new `conditions.json`; `README.md` row.
- `apps/web/index.html`: loader, Explore side panel and markers, new bill route, profile block.
- `.github/workflows/pages.yml`: copy the new file when present.
- No change to `services/`, `data/{taxonomy,issues,people,stances,summaries}.json`, or any existing schema.
