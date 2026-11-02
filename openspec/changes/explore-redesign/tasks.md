# Tasks

## 1. Fast load: derived graph cache + lazy statements

- [x] 1.1 Create `apps/web/lib/derive.mjs` exporting `deriveEdges(statements, people, issues, now)` that reproduces the current in-page aggregation exactly (CONF_W weights, score, n, first/last, flip, salience → heat percentile, latest quote/bill/source) plus `kindOf(statement)` and per-edge kind counts `[sponsored, cosponsored, yea, nay, views, spokeN, spokeMeanScore]`.
- [x] 1.2 Create `apps/web/build/graph.mjs <dataDir> <outFile>`: loads the contract-B files, calls `deriveEdges`, writes the compact `graph.json` (shape in design.md decision 1, indices into `people`/`issues` arrays, bills from statement bill strings with counts, `meta: {statements, maxDate, builtAt}`).
- [x] 1.3 `.github/workflows/pages.yml`: after validation, `node apps/web/build/graph.mjs data _site/data/graph.json`. Add `apps/web/data/graph.json` and `_site/` to `.gitignore` if not already.
- [x] 1.4 `apps/web/index.html` loader: fetch `graph.json` first (optional); when present build COMMITTEES/ISSUES/PEOPLE/EDGES from it and render; fetch `stances.json` in the background and resolve a `STATEMENTS_READY` promise; when absent, load `stances.json` as today and derive with the same inlined code as `derive.mjs` (copy, with a comment pointing at the module). Views that need quotes await `STATEMENTS_READY` and show "loading statements…" until then.
- [x] 1.5 Verify: `node apps/web/build/graph.mjs data /tmp/graph.json` → 8,576 edges; a small script compares edge scores/heat/flip from the cache with the browser derivation (run `derive.mjs` on `data/` twice via the two entry points) → identical.

## 2. Search, Explore on Canvas, fly-to, minimap

- [ ] 2.1 Masthead search (port from `data/_site/search-sample.html` `search()`/`renderDD()`): `/` shortcut, groups ZIP / District / State / Name, arrow keys, Enter → profile. Add `apps/web/assets/zip-to-district.json` (see design decision 7) and a loader for it.
- [ ] 2.2 Replace the SVG Explore with the Canvas option E (port `viewE` from the mock: ring, sector widths, open-in-place tween, member packing, top-K slider, hover/pin, zoom/pan, names at 2.4×, D/R filter, HUD line). Keep: ◆ markers on edges with conditions and the tooltip wording; the bill-grouped conditions side panel; "Open issue page →"; node click → profile. Remove the D3 force simulation and SVG graph code.
- [ ] 2.3 Fly-to: `E_fly(id)` from search results and from the minimap; side card (party, district, strongest committee, top 6 issues, Open profile); click empty → restore.
- [ ] 2.4 Minimap in the Explore side pane (port `drawMM`, tile grid table, state filter chip); recolour on issue/committee focus with labelled legend.
- [ ] 2.5 ResizeObserver-driven sizing for the Canvas and the minimap (port `onResize`).
- [ ] 2.6 Verify locally on real data: first paint < 2 s with `graph.json`; hover a committee → no stall; search `CA-12`, a surname, `tx`, a ZIP; fly-to; minimap recolour and state filter.

## 3. Issues directory, issue page, Bills tab

- [ ] 3.1 Routes: `#/issue/<id>` (load + hashchange); Issues tab without id = directory; keep legislator/bill routes.
- [ ] 3.2 Directory (port `viewI`): committee columns, issue rows with split bars and counts, filter box.
- [ ] 3.3 Issue page (port `issuePage` + `orbit`, the halo version): header, 4-cell strip (for-actions, against-actions, spoke, cosponsored-only), halo canvas with its own draw helpers, party split bars, strongest voices, district tile map coloured by stance, bills under the issue → `#/bill/<id>`, related-issue chips.
- [ ] 3.4 Bills tab (port `viewB`): list + filter; rows → `#/bill/<id>`; nav button added between Issues and Find.
- [ ] 3.5 Remove the old single-issue spectrum (focus) view and its aside; the Issues nav button opens the directory.
- [ ] 3.6 Verify: directory counts match EDGES; Defense Authorization halo shows yea right / nay left with party grouping; deep link `#/issue/<id>` on a fresh load; Bills filter.

## 4. Verify and deploy

- [ ] 4.1 `node packages/contract/validate.mjs data --records data/records` → OK (nothing under data/ changed).
- [ ] 4.2 Local run from repo root on the real data: all tabs, search, fly-to, minimap, issue page, bills, bill page, profile; temporarily rename `graph.json` away → identical rendering from `stances.json`.
- [ ] 4.3 Commits by Muse Code with trailer `Co-Authored-By: Muse Code <noreply@meta.com>`; push; Pages run green; live site loads `graph.json` (check the network tab: no 20 MB fetch before first paint).
