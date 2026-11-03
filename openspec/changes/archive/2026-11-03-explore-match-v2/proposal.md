# Proposal

## Why

The first Explore match build put bill squares on the ring and one card at a time in the side pane. The user wants the questions to hang off the sub-issues instead: clicking an issue node in an opened sector lists that issue's bills as one-line yes/no questions, answerable right there; the match list stays visible under them on the same pane; and the summary gets its own strip under the ring rather than being buried in the side pane.

**Contract:** none (reads `bills.json` as before). **Issue:** #32.

## What Changes

- Remove the bill square nodes from the ring and the `bill=` selection; issue nodes are the entry point.
- Clicking an issue node (or hovering-then-pinning it) shows in the side pane, above the existing issue block: "Questions under <issue>" — every bill with a `binary_question` whose `issue_ids` (or inferred issue) includes that issue, one row each: number, `short_context` on hover, the question, Yes / No toggles (answered state shown, click again to change), "n for · m against" small text. No bills → one muted line.
- Answering recolours member dots by agreement on the **last answered bill** (as before) and bumps the HUD count.
- The match list block renders in the side pane under the questions whenever ≥ 3 answers exist, regardless of which issue is open.
- New strip `#e-summary` under the Explore canvas (above the HUD): the "What your answers say" summary, visible whenever ≥ 1 answer exists; hidden otherwise. Same deterministic text rules (trade-offs only from a `tradeoff` field).
- Bills tab / bill page unchanged from the previous change.

## Capabilities

### Modified Capabilities

- `web-app`: Match in Explore requirement reworded (issue-node entry, question list, summary strip); Explore view scenario "Bills in an opened sector" removed.

## Impact

- `apps/web/index.html` only. Implementation by Muse Code.
