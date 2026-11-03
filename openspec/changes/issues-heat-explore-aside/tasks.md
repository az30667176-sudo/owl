# Tasks

All tasks touch `apps/web/index.html` only. Two commits with the Muse trailer `Co-Authored-By: Muse Code <noreply@meta.com>`: `web: Issues directory shows heat, not stance` and `web: Explore aside as hottest issues, recent changes and state`.

## 1. Issue heat (shared helper)

- [x] 1.1 `issueHeat()` memoised: for each issue, `sal = Σ edge.salience` over its EDGES, `active = count of edges`, `bills = issueBills(id).length`; `heat = percentile rank of sal among issues with ≥ 1 edge` (0…1, first-index-wins like edge heat). Brightness step: ≥ .66 `var(--accent)`, ≥ .33 `var(--accent-dim)` (#c9961f), else `var(--accent-cold)` (#8a6a1a); add the two tokens to `:root`.

## 2. Issues directory

- [x] 2.1 `renderIssuesCenter` / `dirRows`: replace the split bar with `<div class="hbar"><i style="width:${heat*100}%;background:…"></i></div>` and the right column `n active · m bills` (mono, muted); sort issues inside each committee by heat desc; subtitle "N committees · M issues · bar = attention in the last 90 days (recent statements count more) · number = legislators active · bills". Issues with heat < .33 render their name in `var(--muted)`.
- [x] 2.2 "Hottest now" chip row above the committees: five hottest issues, chip = name + 1–5 accent dots by heat quintile; click → `openIssue(id)`; keyboard-reachable.
- [x] 2.3 `renderIssuesSide` text: "The bar is attention, not agreement: how much and how recently legislators acted on the issue. Stances live on bill pages."
- [x] 2.4 Remove the directory's support/neutral/oppose CSS if unused elsewhere.

## 3. Explore aside

- [ ] 3.1 Rewrite `renderExploreAside`: block "Hottest issues · 90 days" — top 8 by `issueHeat`, grid `name | sparkline 54×14 | active`; sparkline = statements per month over the last 12 months (from STATEMENTS when `statementsReady`, else an empty slot filled in by a `STATEMENTS_READY.then(renderExploreAside)` once); row click → `state.f.com = issue.cat` opened on the ring (existing open-sector call used by committee click), `E_highlightIssue(id)` (or the existing hover/pin path that draws all edges of a node — reuse it for the issue node), `syncExploreHash()`; footer link "all 187 →" → `goIssues()`.
- [ ] 3.2 Block "Recent changes · 30 days": collect `{date, kind:"flip", person, issue}` from EDGES with `flip` and `spokeN ≥ 2` dated by `last`, plus `{date, kind:"cond", person, issue}` from CONDS (date = the referenced statement's date when `statement_id` resolves, else the edge's `last`); newest first, max 8, format `● Name set a condition on Issue ◆ Oct 28` / `● Name flipped on Issue ⟲ Oct 21` (party-coloured dot, issue in accent); click → `E_fly(person)`.
- [ ] 3.3 Block "State": chip with the current `state.f.state` and × to clear, plus a small select for choosing one (reuse `STATES`); keep in sync with the minimap chip.
- [ ] 3.4 Remove the search box, issue groups/checkboxes, `all`/`none`, stance chips and confidence chips from the pane; leave `state.f.issues` = all, `state.f.dirs` = all, `state.f.minConf` = 0 so `filteredEdges()` is unchanged; party chips stay in the HUD only. Keep the `.stat` line. Remove CSS only the removed controls used.
- [ ] 3.5 Hash query: `q` still parsed (masthead search), `com` written by the hottest-issue click.

## 4. Verify

- [ ] 4.1 Directory: Defense Authorization at 100% brightest, counts `146 active · 4 bills` (or the real values), chips open issue pages, filter box still works; no red/green left. Explore: aside shows 8 rows with sparklines after statements load, clicking "Defense Authorization" opens Armed Services and lights edges, `#/explore?com=…` in the hash; recent-changes lines fly to members; state chip ↔ minimap; `#/explore?state=CA&party=D` still restores. `node --check`; `node packages/contract/validate.mjs data --records data/records` → OK.
