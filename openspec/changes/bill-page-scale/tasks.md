# Tasks

All tasks touch `apps/web/index.html` only. Commit message `web: bill page scales to cosponsor-heavy bills (capped beeswarm, grouped negotiation map)` with trailer `Co-Authored-By: Muse Code <noreply@meta.com>`.

## 1. Spectrum

- [x] 1.1 In `renderBill` beeswarm branch: per score column draw `min(n, 12)` dots; when `n > 12` add a mono count pill (`.bill-cnt`, accent colour, e.g. `314`) centred above the column; compute `top0` from the capped stack so `specH ≤ 160`.
- [x] 1.2 Kind line under the stance strip: count `info.stmts` by `kindOf` → "N cosponsored · N spoke · N voted" (sponsored counted with cosponsored, views/not-voting omitted), muted `.bill-sub`.

## 2. Negotiation map

- [x] 2.1 Split `legs` into `individual` (has conditions, or any speech-kind statement on the bill, or `proj !== base`) and `grouped` (the rest); cap `individual` at 40 by |score| desc, overflow joins `grouped`.
- [x] 2.2 Group nodes: one per (projection, party) present in `grouped`, label `"<PROJ> · <count> <Democrats|Republicans|Independents>"`, circle radius scaled by count (min 14, max 28 px), fill = party colour, one edge to the bill node whose colour follows the projection; row height 96 px like individual nodes; SVG height = 110 + (individual + groups) × 96.
- [x] 2.3 Clicking a group node lists its members (name, seat, score) in the side pane under a "Grouped · <label>" heading; a "+N more" link under the map does the same for the overflow.
- [x] 2.4 Re-run the split on every tick so a grouped legislator who moves becomes individual.

## 3. Verify

- [x] 3.1 `#/bill/hr1262` (314 cosponsors): spectrum ≤ 160 px with a "314" pill, kind line, map = group nodes only, page height under 1,500 px; `#/bill/hr8800` (57 scored, conditions present) still shows individual rows for condition holders; a bill with ≤ 12 scored unchanged; `node --check`; `node packages/contract/validate.mjs data --records data/records` → OK.
