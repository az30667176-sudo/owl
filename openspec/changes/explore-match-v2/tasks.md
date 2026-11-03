# Tasks

All tasks touch `apps/web/index.html` only. One commit: `web: match questions hang off issue nodes; summary strip under the ring` with trailer `Co-Authored-By: Muse Code <noreply@meta.com>`.

## 1. Ring and selection

- [x] 1.1 Remove `E.billNodes` creation in `E_build`, their drawing in `E_draw`, their hit-test in `E_nodeAt`, the `hov.kind === "bill"` branch in `E_click`, and the `bill=` hash param (`syncExploreHash` / `applyExploreQuery`). Keep `state.e.lastBill` (new) = last answered bill id for member lighting; `clear answers` resets it.
- [x] 1.2 Member lighting in `E_draw` uses `state.e.lastBill` instead of the selected bill.

## 2. Questions under an issue

- [x] 2.1 `billsForIssue(issueId)`: bills with `binary_question` where `issue_ids` includes the issue, else where `billInfo(billId(number)).issue === issueId`; memoised per issue.
- [x] 2.2 In the side pane renderer for a hovered/pinned/clicked issue node (`E_issueHtml`), prepend a block "Questions under <issue name>": one row per bill — `.mq` row with number (mono), question text (title attribute = `short_context`), two toggle buttons Yes / No (`aria-pressed` reflects the stored answer; clicking the pressed one clears that answer), small "n for · m against" from `billLegs`. Answering → `MATCH.answers[bill_id]`, `saveMatch()`, `state.e.lastBill = bill_id`, `E_draw()`, re-render the pane, HUD count. No bills → muted line "No questions under this issue yet."
- [x] 2.3 Clicking an issue node pins it (existing pin path) so the list stays while answering.

## 3. Match list placement

- [x] 3.1 The existing match board block (filters, closest / farthest, rule line) renders at the bottom of `renderExploreSide` whenever ≥ 3 answers exist, after the questions / issue block and after the default content; it must no longer depend on a selected bill.

## 4. Summary strip

- [x] 4.1 New `<div id="e-summary">` inside the Explore centre pane between the canvas and the HUD; hairline top, 12 px 16 px padding, `.h` label "What your answers say", then the summary text (same template rules as before; trade-off lines only from `options[].tradeoff`). Shown when ≥ 1 answer, hidden otherwise; re-rendered on every answer and on clear. Include its height in `E_paneSize` so the canvas shrinks instead of overflowing.
- [x] 4.2 Remove the summary from the side pane.

## 5. Verify

- [x] 5.1 With the gitignored sample: open Armed Services → click "Defense Authorization" → two question rows (H.R. 8800, H.R. 3838); answer Yes → dots lit, HUD "1 answered", strip appears; answer two more under other issues → board under the questions; reload → kept; clear → strip hidden, dots back to party colour. Without `bills.json`: no questions block, no strip, Explore unchanged. `node --check`; `node packages/contract/validate.mjs data --records data/records` → OK.
