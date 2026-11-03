# Tasks

All tasks touch `apps/web/index.html` unless stated. One commit per group, message `web: <group title>`, trailer `Co-Authored-By: Muse Code <noreply@meta.com>`. Nothing under `data/`, `services/`, `packages/`, `apps/web/lib/`, `apps/web/build/` changes.

## 1. Router and dead code

- [x] 1.1 Add `routeFromHash()` mapping `#/explore` (and empty hash), `#/issue`, `#/issue/<id>`, `#/bills`, `#/bill/<id>`, `#/find`, `#/legislators`, `#/legislator/<id>`, `#/about` to `state.mode`; call it on load and on `hashchange`; nav buttons set `location.hash` instead of `state.mode`.
- [x] 1.2 Remove `renderFocusAside`, `renderFocusSide`, the `mode === "focus"` branch and any CSS only they used; `node --check` the extracted script.

## 2. Titles and share metadata

- [x] 2.1 `renderHeader()` sets `document.title` per route (table in the delta spec).
- [x] 2.2 `<head>`: meta description, `og:title`, `og:description`, `og:image` = `https://az30667176-sudo.github.io/owl/assets/logo/owl-mark-512.png`, `og:url` + `<link rel="canonical">` = `https://az30667176-sudo.github.io/owl/`, `twitter:card` summary.

## 3. Responsive layout and touch

- [x] 3.1 CSS: `@media (max-width: 899px)` makes `.pgrid` one column; `body[data-pane=…]` shows only that pane; masthead keeps brand, nav, search; `.pane-switch` segmented control (Filters / View / Details) using existing tokens, hidden ≥ 900 px.
- [x] 3.2 `state.pane` (default `view`, reset on route change); switch click sets it and re-renders; ResizeObserver resizes the Canvas and minimap when the view pane appears.
- [x] 3.3 Explore Canvas: Pointer Events (`pointerdown/move/up/cancel`), one-pointer drag pan, two-pointer pinch about the midpoint with the wheel clamp, tap (< 6 px) = click; `touch-action: none` on the Canvas; keep mouse fallback when `window.PointerEvent` is undefined.
- [x] 3.4 Verify at 375 × 812 (Explore, profile, issue page, bills) — no horizontal scroll, switch works, pinch zooms.

## 4. Keyboard access and reduced motion

- [x] 4.1 Skip link as first element (`<a class="skip" href="#main">Skip to content</a>`), `id="main"` on the centre pane; `:focus-visible` ring with `var(--accent)`.
- [x] 4.2 Legislators table rows, Issues directory rows, Bills rows, profile attention rows, search results, issue "strongest voices" and bill lists: focusable (`tabindex="0"` + `role="link"` or real `<a>`/`<button>`), Enter/Space activates via one shared keydown handler; `aria-label` on icon-only buttons (zoom, pin, close, pane switch) and `aria-label="Find a legislator"` on the search input.
- [x] 4.3 `prefers-reduced-motion`: `E_fly` and sector open/close tweens use duration 0; CSS transitions disabled.
- [x] 4.4 Verify: Tab from the skip link through Legislators rows → Enter opens profile; no element lacks a visible focus state.

## 5. About page

- [x] 5.1 `renderAbout()` for `#/about`: sections — What OWL is; The six files (taxonomy, issues, people, stances, summaries, conditions) one line each; How a position is scored (score / direction ±0.15 / flip / salience half-life 180 d / heat percentile — wording copied from `packages/contract/derived.md`, with an HTML comment naming that file); Data snapshot ("Data through <maxDate>", statement / member / issue / condition counts from the loaded arrays); AI disclosure (Muse Spark scoring, Muse Code implementation, Claude Code orchestration, no model calls in the browser); Source (repo link, licence).
- [x] 5.2 Masthead: "About" link in the nav row; Explore side pane footer line "How this is scored → About".

## 6. Shareable Explore state

- [x] 6.1 `exploreStateToQuery()` / `applyExploreQuery()` for `state`, `com`, `party`, `k`, `q`; written with `history.replaceState` on every filter change; omitted when at defaults; read in `routeFromHash()`.
- [x] 6.2 "Copy link" in the Explore side pane copies the current URL (reuse the profile copy-link helper).
- [x] 6.3 Verify: load `#/explore?state=CA&party=D` fresh → CA chip, D only; clear filters → hash is `#/explore`.

## 7. CSV export

- [x] 7.1 `toCSV(rows, cols)` (RFC 4180 quoting, UTF-8 BOM) + `downloadBlob(name, text)`.
- [x] 7.2 Legislators view toolbar: "Download CSV" exporting the filtered `rows` with the columns in the delta spec; profile hero: "Download CSV" exporting the member's statements (awaits `STATEMENTS_READY`).
- [x] 7.3 Verify: filter to N rows → file has N data rows; open in a spreadsheet, quotes intact.

## 8. Empty states

- [x] 8.1 Profile: when every edge has `spokeN == 0`, insert the note "No hearing statements yet — positions below come from sponsorship and votes." above the attention list (muted `.sub`).
- [x] 8.2 Issue page: when no condition rows reference the issue, hide the Conditions block and show "No conditions recorded for this issue."

## 9. Print

- [ ] 9.1 `@media print`: hide masthead, nav, pane switch, `.aside`, `.side`; light tokens; full quotes; profile prints Overview + Timeline regardless of active tab; bill page prints all statements.
- [ ] 9.2 Verify with the browser print preview on `#/legislator/D000216` and one bill.

## 10. Load order and assets

- [ ] 10.1 `<script defer>` on the D3 tag; module script after it; confirm first paint and Explore still work with `graph.json` present and absent.
- [ ] 10.2 Confirm `assets/zip-to-district.json` is fetched only when a query starts with a digit (it is already lazy — leave if so).
- [ ] 10.3 Delete unreferenced logo files (`owl-mark.png`, `owl-mark-m.png`, `owl-mark-32/128/256.png`); keep 64 and 512; update `apps/web/assets/README.md` line for `logo/`.

## 11. Final check

- [ ] 11.1 `node --check` on the extracted script; `node packages/contract/validate.mjs data --records data/records` → OK; smoke all routes at desktop and 375 px.
