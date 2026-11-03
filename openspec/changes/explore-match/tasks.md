# Tasks

All tasks touch `apps/web/index.html` only (plus ticking boxes here). Three commits with the Muse trailer `Co-Authored-By: Muse Code <noreply@meta.com>`: `web: load optional bills.json; bill context and question on Bills tab and bill page`, `web: Explore bill nodes and answer card`, `web: match list and summary in the Explore side pane`.

## 1. Load bills.json

- [x] 1.1 Loader: fetch `bills.json` alongside the other files (optional, tolerate 404); `BILLS = []`, `billById` map keyed by `bill_id`; a bill's committee = `issueById[b.issue_ids[0]].cat` (first resolvable issue), else matched by `billId(number)` against statement bill strings → the issue with most statements for that bill (reuse `billInfo(id).issue`). Helper `billQ(id)` → bill record with `binary_question` or null.
- [x] 1.2 Bills tab rows: show `short_context` under the title when present and a "?" tag when the bill has a question. Bill page: under the `bill-sub`, show `short_context` and the question with its two options as read-only pills (answering lives in Explore; add a link "Answer it in Explore →" that sets `#/explore?com=<committee>&bill=<bill_id>`).
- [x] 1.3 Verify with the gitignored sample `apps/web/data/bills.json` (17 bills) and with the file removed (no errors, nothing shown).

## 2. Explore bill nodes and answer card

- [ ] 2.1 `E_build`: when a sector is open, add the committee's bills with questions as nodes `{kind:"bill", id, x, y}` placed on a second, slightly inner arc inside the sector (same angular spread as the issues; if more than 8 bills, pack two rows); square 9 px, stroke `var(--accent)`, fill `var(--bg)`; answered yes → fill support colour, no → fill oppose colour. Label on hover/zoom: bill number. `E_nodeAt` returns bill nodes; `E_click` on a bill → `state.e.bill = id`, `renderSide()`.
- [ ] 2.2 Side pane card (`renderExploreSide` when `state.e.bill`): number, title, `short_context`, question, two option buttons (labels from `binary_question.options`, support = green outline, oppose = red outline), Skip (clears selection), "n members on record for · m against" from `billLegs`. Answer → `MATCH.answers[bill_id] = stance` saved to `localStorage("owl-match")`, bill node recoloured, `E_draw()`.
- [ ] 2.3 Member lighting while a bill is selected: `E_draw` fills member dots by `billLegs` direction vs the answer (agree = support colour, disagree = oppose colour, no record / neutral = dimmed to 30% alpha); edges unchanged; clearing the selection restores party fill. HUD gains `n answered` (count of stored answers) and a "clear answers" link.
- [ ] 2.4 Hash: `bill=<bill_id>` in the Explore query selects that bill and opens its committee on load.
- [ ] 2.5 Verify: open Armed Services → bill squares appear with the issues; click one → card; answer Yes → node green, dots lit; reload → still green, HUD count kept; no `bills.json` → no squares.

## 3. Match list and summary

- [ ] 3.1 Side pane, below the card (or in place of it when no bill is selected) once `Object.keys(MATCH.answers).length ≥ 3`: block "Your match board" — filters: state (reads/writes `state.f.state`, same as the chip and minimap), party chips All / D / R, min-overlap select 2–5 (default 3); ranking per member = agree / n over answered bills where `billLegs` direction is support or oppose; list closest 10 and farthest 10 with party dot, name, seat, `pct · agree/n`, bar; rows open profiles via `openProfile`; `kbRow` on rows; empty state when nobody reaches the minimum.
- [ ] 3.2 Rule line: "Share of bills you answered on which the member has a recorded position (sponsorship, cosponsorship, vote or statement) matching your answer; members under the minimum are not ranked."
- [ ] 3.3 Summary block "What your answers say": sentence 1 — "You answered N bills: yes on A, no on B."; sentence 2 — "Most of your answers fall under <top 1–2 committees>."; sentence 3 — "You sided with the recorded majority on X of N." Then, only when any chosen option carries `tradeoff` (string), a list "What you accepted:" with one line per chosen option's tradeoff. Never generate trade-off prose when the field is absent.
- [ ] 3.4 Verify: answer 4 bills from the sample → list ranks (e.g. 67% · 2/3), state = CA narrows it, party chips work, summary sentences correct, no trade-off section (sample has none). `node --check`; `node packages/contract/validate.mjs data --records data/records` → OK.
