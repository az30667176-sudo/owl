# Design

## Context

See proposal.md — Why. The app is one file (`apps/web/index.html`, ~2,200 lines, vanilla JS + D3 7 from cdnjs, no build). Layout is a three-column grid (`.aside` filters · centre view · `.side` details) driven by `state.mode` ∈ explore / issues / issue / bills / list / profile / bill, rendered by `renderAside()` / `renderCenter()` / `renderSide()` from `render()` on every hash change. Explore is a Canvas (`E_*` functions) with mouse wheel/drag handlers and `E_fly()`; dead `renderFocusAside/Side` and a `mode === "focus"` branch remain from the removed spectrum view. The hash router recognises `#/legislator/<id>`, `#/bill/<id>`, `#/issue`, `#/issue/<id>`; other modes are set by nav buttons and not reflected in the hash. The masthead has a crumb slot (`$crumb`) and a hint slot (`$hint`).

Constraints: no change to `data/`, `services/`, `packages/contract/`, `lib/derive.mjs`, `build/graph.mjs`; no new scoring rules; English only; design tokens from the existing `:root` block; hairline editorial style, no cards-in-cards.

## Goals / Non-Goals

**Goals:** phone-usable; every route shareable with a correct title and preview; keyboard-complete; a methodology page that reads the real loaded data; no dead code.

**Non-Goals:** no framework or build step; no service worker / offline; no server-side rendering of per-route OG tags (GitHub Pages is static — one static set is enough); no redesign of any view; no change to how edges are computed.

## Decisions

1. **Router carries every mode.** Give every mode a hash (`#/explore`, `#/issue`, `#/bills`, `#/find`, `#/legislators`, `#/about`) and derive `state.mode` from the hash in one `routeFromHash()` used by load and `hashchange`; nav buttons set `location.hash`. Explore filters live in the hash query via `URLSearchParams`, written with `history.replaceState` so filter changes do not pollute history. Alternative: keep nav in memory and only encode Explore — rejected because titles and share links need every mode addressable.
2. **Responsive via CSS class on `<body>` + a pane switch**, not a second layout. Below 900 px `.pgrid` becomes one column and only the pane named by `state.pane` (`filters | view | details`, default `view`) is displayed; the switch is a segmented control rendered in the masthead row below the nav. ResizeObserver already recomputes the Canvas; the Canvas reads the pane's size so nothing else changes. `state.pane` resets to `view` on route change.
3. **Touch on the Canvas with Pointer Events.** Replace mouse-only handlers with `pointerdown/move/up` + a two-pointer map for pinch (distance ratio → scale about the midpoint, same clamp as wheel). `touch-action: none` on the Canvas so the page does not scroll. Tap = pointerup with < 6 px movement.
4. **Keyboard access by semantics, not scripts.** Rows that open things become `<button class="row">` or `<a href="#/…">`; where a row must stay a `<tr>` it gets `tabindex="0"` + `role="link"` + a shared keydown handler for Enter/Space. Focus ring: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`. Canvas dots cannot be focused individually; the Explore side pane lists the hovered/pinned member's edges as real links, which is the keyboard path. Reduced motion: `E_fly` and the sector tween read `matchMedia("(prefers-reduced-motion: reduce)")` and set duration 0.
5. **About page reads `derived.md` wording by hand, not at runtime.** The text is copied verbatim into the page (a fetch of `packages/contract/derived.md` would break on Pages where `packages/` is not deployed). Counts and the snapshot date come from the loaded arrays (`graph.json.meta.maxDate` when present, else max statement date). A comment next to the block names the source file so the two are kept in step.
6. **CSV in the browser.** A small `toCSV(rows, columns)` escaping quotes per RFC 4180, `Blob` + object URL download; filename `owl-legislators-<date>.csv` / `owl-<member-id>-<date>.csv`. Quotes are the `quote` field byte-for-byte (frontend non-goal honoured).
7. **Print via `@media print`**: hide `.masthead`, `.aside`, `.side`, `.nav`, the pane switch; set `--bg` white and `--ink` dark for print only; expand truncated quotes (`.quote { white-space: normal }`); Timeline tab content is rendered when printing a profile regardless of the active tab.
8. **D3 deferred.** `<script defer>` for D3 and the module script; the inline loader already awaits data, so order is preserved by placing the module after D3.
9. **Logo pruning.** Only `owl-mark-64.png` (masthead) and `owl-mark-512.png` (OG image) are referenced; the other sizes are removed from the repo (they are not used by README either).

## Risks / Trade-offs

- [Hash routing for every mode changes the Explore default URL from `/owl/` to `/owl/#/explore`] → bare `/owl/` still routes to Explore; only links written after this change carry the hash.
- [Pointer Events on older iOS Safari] → fallback to the existing mouse handlers when `window.PointerEvent` is undefined; pinch unavailable there.
- [About text drifting from `derived.md`] → comment with the source path and the rule that a contract change must update both.
- [Making `<tr>` focusable inflates the Tab stop count on the 8,576-row table] → the table already paginates/filters; the pane switch and skip link let keyboard users bypass it.
- [Print of a 53-issue profile is long] → acceptable; the user chose to print.

## Migration Plan

Ten commits on `main`, one per proposal item, each independently deployable; Pages redeploys on push. Rollback = revert the commit. No data migration.
