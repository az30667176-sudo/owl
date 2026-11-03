# Proposal

## Why

Issue #32 (Ben) adds, per bill, a one-line `short_context` and a yes/no `binary_question` to `bills.json`, and asks for a picker plus a ranked "who matches you" board. The user wants this inside Explore, not on a new page: open a committee on the ring, see its bills, answer a bill's question, watch the ring light up by agreement, and read a ranked list and a summary in the side pane. The contract for `bills.json` landed in `1d4b3f5`; the data is not there yet, so the feature reads the file when present and hides itself when absent.

**Contract:** reads the new optional `bills.json` (no change). **Issue:** #32. One follow-up request to the process side: a per-option `tradeoff` sentence so the summary can say what each answer gives up (requested in the issue, not blocking).

## What Changes

- **Explore, opened sector**: alongside its issues the sector shows the committee's bills that carry a `binary_question` as small square nodes (◆-style marker "?"); a bill the user has answered is drawn green (yes) or red (no).
- **Bill card in the side pane**: clicking a bill node shows number, title, `short_context`, the question and its two options plus Skip; answering stores the choice in `localStorage`, recolours the bill node, and lights every member dot by that bill's recorded position relative to the answer (agree = support colour, disagree = oppose colour, no record = dim). The HUD shows `n answered`.
- **Match list in the side pane** (after ≥ 3 answers): filters state (bound to the existing state chip), party, minimum overlap; ranked members by agreement share with "closest" and "farthest" halves; each row opens the profile; a one-line rule statement.
- **Summary block**: deterministic text from the answers: how many bills answered, which side the user took most, the committees involved, and — when `bills.json` options carry a `tradeoff` string — the trade-off sentences for the chosen options. No model call in the browser.
- **Bills tab and bill page** show `short_context` and the question when present (read-only there).
- Absent `bills.json` or bills without questions: no bill nodes, no card, no list; Explore behaves exactly as today.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-app`: Data loading (optional `bills.json`), Explore view (bills in an opened sector), new Match-in-Explore requirement, Bills tab / Bill page show context + question.

## Impact

- `apps/web/index.html` (loader, `E_build` / `E_draw` / `E_click` for bill nodes, side pane renderers, HUD, Bills tab, bill page). Local development uses a gitignored `apps/web/data/bills.json` sample; nothing under `data/`, `services/`, `packages/`, `apps/web/lib/`, `apps/web/build/` changes. Implementation by Muse Code.
