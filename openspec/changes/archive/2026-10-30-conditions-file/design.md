# Design

## Context

See proposal.md — Why. Contract B today is five files; `summaries.json` is the only optional one and the loader, validator and UI already treat it as "present or empty". Interactive mocks agreed with Kurt live in `data/_site/` (gitignored, local only): `explore-conditions-b.html` (Explore lens) and `bill-page.html` (bill page). They are the visual reference for this change.

Constraints set by Kurt for this change: implemented by Muse Code (commit trailer `Co-Authored-By: Muse Code <noreply@meta.com>`); one new JSON file, the five existing files untouched; OpenSpec; no change under `services/`; the contract change is announced with a `contract` issue.

## Goals / Non-Goals

Goals
- A container the process team can fill on their own schedule.
- Same trust discipline as stances: verbatim quotes against records.
- UI invisible when the ledger is empty.

Non-Goals
- An extractor (process-team work; a prototype prompt is recorded in the issue).
- `bills.json` (bill metadata such as status and last action); bill title comes from the bill string in statements.
- Muse-written read-across narration; the bill page uses a deterministic sentence.

## Decisions

1. **One file, two arrays (`demands`, `conditions`).** A registry is needed so "water-use cap" on two bills is the same node; putting it in the same file keeps the rule "one new JSON".
2. **`statement_id` nullable.** A condition may come from a record whose statements are not yet in `stances.json`; requiring a link would force edits to `stances.json`. When present it must match person.
3. **`stance_if_met` ∈ {support, oppose} + `scope` ∈ {vote, final_passage}.** Distinct from `direction` so it is never averaged into scores. `final_passage` captures "supports now, withholds the final vote until X".
4. **`excludes` on demands** drives the toggle exclusivity on the bill page instead of hard-coded rules.
5. **Bill id derivation.** `hr6110` from "H.R. 6110 …": lower-case the leading bill number, keep letters and digits. Bills are discovered from `stances.bill` and `conditions.bill` strings; the title is the text after the number in the most recent statement.
6. **Projection model on the bill page.** Base = current stance on the bill (weighted score of that legislator's statements whose bill id matches, else on the issue; none → UNKNOWN). For ticked demands: any oppose-if-met → NO; else any support-if-met with scope vote → YES; scope final_passage → keeps base but marks "final vote secured"; an unmet final_passage condition while `clean` is ticked → UNKNOWN.
7. **Colour rule.** Node fill = party; stance only in edge colour and the YES/NO label. Palette tokens unchanged in this change (the R vs oppose separation is a design-system follow-up).
8. **Explore stays current-only.** No glyphs or what-if labels on the graph; the ◆ tooltip is the only what-if surface.

## Risks / Trade-offs

- [Single index.html grows large] → new code grouped in clearly named functions (`renderBill`, `renderConditionsPanel`, `conditionsBlock`); no refactor of existing code.
- [Mock ledger has no statement links] → acceptable by design (decision 2); the bill page shows "no statement on file" for such legislators.
- [Muse Code edits a 700-line file] → work split into three tasks, each verified with the validator, a local server and screenshots before the next.

## Migration Plan

1. Contract + mock ledger (no UI change). 2. Explore + profile. 3. Bill page. 4. Open the `contract` issue. Rollback: delete `data/conditions.json`; everything hides.

## Open Questions

- Palette separation between Republican and oppose colours (design-system change).
- `bills.json` for status / last action ordering.
