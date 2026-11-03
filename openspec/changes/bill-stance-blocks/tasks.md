# Tasks

All tasks touch `apps/web/index.html` only. One commit: `web: one negotiation map for every bill — support / oppose nodes with rosters, what-if forks for condition holders` with trailer `Co-Authored-By: Muse Code <noreply@meta.com>`.

## 1. Map for every bill

- [x] 1.1 Remove the `hasConds` gate around the map and the "No conditions on record…" note; always render `#billmap`. Keep the whip bar + caption above it. Set `colHtml = ""` on every bill and delete the `.bill-cols` CSS if nothing else uses it.
- [x] 1.2 Layout: bill node at x 120 (as today). Demand column at x 380 only when `demands.length > 0`. Right column at x 530 (or 380 when there is no demand column — then the bill→aggregate lines are straight curves). Rows: individual legislators first (existing `indiv` logic: condition, speech-kind statement, or `proj !== base`; cap 40), then the aggregate nodes Support, Oppose, Not clear (Not clear only when its count > 0). Row pitch 34 px for individuals, 56 px for aggregates; SVG height = 110 + sum + 40.
- [x] 1.3 Aggregate node: 16 px rounded rect 150 × 40 with `var(--line)` stroke; label `Support · n` (mono, support colour) / `Oppose · n` / `Not clear · n`; inside, a 6 px party-split bar (D / R / I in `partyColor`) with counts as `<title>`; one edge from the bill node coloured support / oppose / muted, width 2 + 2 × log10(n + 1); a ▸/▾ disclosure glyph at the right end; clicking the node toggles its roster (`state.b.rost[key]`). Members = legislators not in `indiv`, keyed by projection `byP[id].proj` (YES → Support, NO → Oppose, UNKNOWN → Not clear).
- [x] 1.4 Roster HTML under the SVG (`.rost`, one block per open aggregate, in map order): header `Support · n`, rows `party dot · shortName · seat · score` (score blank when null), first 20 then "Show all n" / "Show fewer" (`state.b.rostAll[key]`); rows `data-p`, `kbRow(el, "link")`, click → `openProfile`.
- [x] 1.5 Re-run the split on every tick (existing behaviour) so movers leave the aggregates; the aggregate labels and party bars re-render with the new counts.
- [x] 1.6 Truncate every SVG text to its available width with an ellipsis (existing `trunc`), full text in `<title>`.

## 2. Verify

- [x] 2.1 `#/bill/hr1262`: no demand column; Support · 314 (180 D / 133 R / 1 I) and Oppose · 0; open Support → 20 rows → "Show all 314" → 314 rows; click a row → `#/legislator/<id>`; Tab + Enter works. `#/bill/hr8800`: Support · 26 / Oppose · 30 / Not clear · 1. `#/bill/hr4054` (16 conditions): demand node, 16 forked rows, Support · 2 aggregate; tick the demand → projections update. `node --check`; `node packages/contract/validate.mjs data --records data/records` → OK.
