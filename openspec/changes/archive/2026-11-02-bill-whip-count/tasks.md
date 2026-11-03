# Tasks

All tasks touch `apps/web/index.html` only. One commit: `web: whip-count bar on the bill page; negotiation map only when conditions exist` with trailer `Co-Authored-By: Muse Code <noreply@meta.com>`.

## 1. Whip-count bar

- [x] 1.1 In `renderBill`, after the "What it would take" heading, render `.whip` — a 22 px stacked bar: segments YES-D, YES-R, YES-I, NO-D, NO-R, NO-I, UNKNOWN, then "not on record" (chamber members in `PEOPLE` minus those with a projection) in `var(--panel)`/muted. Party segments use `partyColor`; YES/NO is encoded by a 2 px top border in support/oppose colour, not by fill. Segment text = count + party letter in mono when the segment is ≥ 36 px wide; hover title always.
- [x] 1.2 Caption line in mono: `YES n · NO n · UNKNOWN n · <majority> needed · <sign><|YES − majority|>` where majority = 218, or 51 when the bill id starts with `s`; YES coloured support, NO oppose.

## 2. Map only with conditions

- [x] 2.1 When `info.conds.length === 0`: do not render `#billmap`; render the note "No conditions on record for this bill, so nobody moves. The negotiation map appears once the conditions ledger has rows for it." as a `.bill-sub` with a 2 px left hairline (`border-left: 2px solid var(--line)`), padding 10 px 12 px. Remove the `bill-sub` "Tick demands in the side pane…" line in this case.
- [x] 2.2 When conditions exist: keep the demand nodes, edges and toggles; individual rows = legislators with a condition, a speech-kind statement, or `proj !== base`; each row: 7 px party dot, name (Public Sans 13 px), then one clause in mono 11 px — the `why` from `billProject` when present, else the first condition's `"YES if <demand>"`/`"NO if <demand>"`, else `"<PROJ> · spoke"`. Row height 34 px.
- [x] 2.3 Replace all group circles with one bottom row: a 14 px rounded square in `var(--muted)`, text `"N others unchanged · a D YES · b R NO[ · c UNKNOWN]"`, clicking it lists them in the side pane (reuse the existing "Grouped" side-pane list). SVG height = 110 + rows × 34 + 40.
- [x] 2.4 No clipped labels: measure available width (SVG width − text x − 12) and truncate names and clauses with an ellipsis; keep the full text in a `<title>`.
- [x] 2.5 Remove the now-unused group-node code and CSS.

## 3. Verify

- [x] 3.1 `#/bill/hr1262`: bar 180 D / 133 R / 1 I + remainder, caption `YES 314 · NO 0 · UNKNOWN 0 · 218 needed · +96`, no `#billmap`, note shown, section height under 140 px. `#/bill/hr8800`: bar YES 26 / NO 30 / UNKNOWN 1, no map (no conditions). A bill that has condition rows (find one via `CONDS[0].bill`): map with individual rows and one "others" row, nothing clipped; tick a demand → mover appears as a row. `node --check` on the extracted script; `node packages/contract/validate.mjs data --records data/records` → OK.
