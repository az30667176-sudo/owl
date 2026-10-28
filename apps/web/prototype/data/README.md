# Prototype data contract

> Authoritative schemas + validator: [`packages/contract/`](../../../../packages/contract/README.md). This file is the frontend-side description of the same shapes.

The prototype UI loads these four files at startup. Drop real data in the same shape and the UI works unchanged.
All ids are stable strings; names are display-only.

| File | One row per | Key fields |
|---|---|---|
| `taxonomy.json` | House standing committee (level 1) + its subcommittees (level 2) | `committees[].id`, `committees[].subcommittees[].id` |
| `issues.json` | Concrete issue (level 3) | `id`, `name`, `parent` → a subcommittee id (or a committee id when it has no subcommittees) |
| `people.json` | Legislator (U.S. House members, all 50 states; no senators in current scope) | `id`, `bioguide_id`, `name`, `chamber` (always `house` for now, kept for schema stability), `state` (2-letter), `district` (`CA-12`), `party` (`D`\|`R`\|`I`), `gender` (`F`\|`M`), `since` (year) |
| `stances.json` | **statement** (one speech / vote / sponsorship) | `statement_id`, `person` → people id, `issue` → issue id, `date` (ISO), `score` [-1, 1], `direction` (`support`\|`oppose`\|`neutral`), `linkage`, `llm_confidence` (`low`\|`mid`\|`high`\|`super_high`), `quote` (verbatim), `bill`, `source` (URL), `model` |

### How the UI aggregates statements

A legislator can speak on the same issue many times. The data stays one-row-per-statement; the UI folds rows into one edge per (person, issue):

- `score` = confidence-weighted mean of statement scores (weights low .4 / mid .7 / high 1 / super_high 1.2)
- `direction` = derived from the aggregated score
- `n` = statement count (shown as ×N), `first` / `last` = date range
- `flip` = true when non-neutral directions differ across statements (shown as ⟲) — the UI never hides this
- evidence panel lists every statement newest-first with a score-over-time sparkline

So the backend should **never pre-aggregate**; emit every statement and let the UI (or a later API) fold them.

## Where each file comes from in production

- `taxonomy.json` → congress.gov `GET /committee/house` + `GET /committee/house/{code}` (subcommittees). Regenerate per Congress.
- `people.json` → congress.gov `GET /member?currentMember=true`, filtered to the House (435 voting members + delegates). `bioguide_id` is the join key for everything else.
- `issues.json` → LLM stage (Muse Spark) clusters bills / speeches under a subcommittee into named issues; human-reviewed.
- `stances.json` → LLM stage output, validated against `packages/contract/stance.schema.json`.

## Rules

- A stance's `quote` must be a verbatim substring of the text at `source`. The UI shows it as the evidence for the score.
- `direction` is derived from `score` (> 0.15 support, < -0.15 oppose, else neutral); keep both so the UI never recomputes.
- Unknown `parent` / `person` / `issue` ids are dropped by the loader and logged to the console — fix the data, not the UI.
- Files marked `"mock": true` in `_meta` contain fictional legislators. Never ship them.

## `summaries.json` (optional)

Per-legislator AI summary, generated **offline** by Muse Spark and committed as data. Shape: `{ summaries: { <person_id>: { model, generated_at, sentences: [ { text, cites: [statement_id, ...] } ] } } }`.
Rules: every sentence cites at least one `statement_id` it relies on; cited statements must belong to that legislator; neutral wording, no praise/blame adjectives. The UI renders citations as clickable numbers that open the quoted statement. Missing file or missing legislator = the card shows "not generated yet".
