# Proposal

## Why

Real data landed (27,248 statements → 8,576 legislator–issue edges, 451 members, 187 issues). Explore draws every edge as an SVG element with a free force layout: the page stalls and the graph is an unreadable ball (see the team's screenshots of 2026-11-02). Finding one member among 451 is slow, the Issues view's −1…+1 spectrum collapses because real scores sit at ±0.8, and bills have no entry point of their own. The prototypes agreed with Kurt (Explore option E, search + fly-to, linked district minimap, issue "halo" page, Bills tab) fix all four without touching the data contract or the scoring rules.

Contract: **none**. Scoring (`derived.md` aggregation, thresholds, flip, heat): **unchanged**. No file under `data/` or `services/` is modified. The only new build artifact is a derived cache (`graph.json`) assembled at deploy time from contract-B files using the existing contract-C rules; it carries the same numbers the browser computes today.

## What Changes

- **Fast load.** A build script (`apps/web/build/graph.mjs`) derives the per-edge graph (score, heat, flip, n, action-kind counts) from the contract-B files and writes `graph.json` (≈0.5 MB vs 20 MB). The Pages workflow runs it into `_site/data/`. The app loads `graph.json` first and paints; `stances.json` is fetched lazily only for views that need quotes (profile, evidence, bill page). When `graph.json` is absent (local dev) the app derives the same structure in the browser from `stances.json` as today.
- **Explore = option E on Canvas.** Committees on a fixed ring, sector width ∝ members whose strongest committee it is; click a committee to open it in place (sector widens, its issues appear on the ring); members placed in their strongest committee's sector at a radius set by specialisation rank; top-K edges per member (slider), hover/pin shows all edges of a node; zoom/pan, names appear when zoomed or searched; D/R filter. Existing edge encoding (colour by direction, width by heat, opacity by |score|, dashed when flip) unchanged. Node colour = party only. ◆ markers and the bill-grouped conditions panel are kept.
- **Global search** in the masthead (`/` shortcut): name, state, district (`CA-12`), ZIP via a static ZIP→district table. Enter opens the profile; on Explore a result flies to the member.
- **Linked minimap** in the Explore side pane: US tile grid, one cell per district; graph focus on an issue/committee recolours it by stance with a labelled legend; hover/click a cell highlights/flies in the graph; clicking a state filters the graph to that delegation.
- **Issues** becomes a directory (committee → issues with support/neutral/oppose bars) and an issue page `#/issue/<id>`: the action halo (one half-ring per kind of action, right = for, left = against, dots = members in party colour), party split bars, strongest voices, stance-coloured district map, bills under the issue, related issues. The old single-issue spectrum view is retired.
- **Bills** tab: list of all bills in data (number, title, issue, statement count, ◆ condition count), filter box; rows open the existing `#/bill/<id>` page.
- Action kind per statement is inferred in the browser from `model` and `rationale` (metadata → sponsored/cosponsored, rule → vote/views/not-voting, else speech) until the contract gains a `kind` field; the inference is isolated in one function so it can be deleted later.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-app`: data loading (graph cache + lazy statements), Explore view (ring layout, Canvas, search/fly-to, minimap), Issues view (directory + issue page), new Bills tab, search.

## Impact

- `apps/web/index.html` (major: loader, Explore renderer, Issues, Bills, search, minimap); `apps/web/build/graph.mjs` (new); `apps/web/assets/zip-to-district.json` (new, static); `.github/workflows/pages.yml` (run the build script into `_site/data/`).
- No change to `packages/contract/`, `data/`, `services/`.
- Reference mocks (local only, gitignored): `data/_site/search-sample.html`, `data/_site/explore-options.html`, `data/_site/bill-page.html`; published prototype https://claude.ai/artifact/GhzJuPDAYqTkEt7PeaXFmY.
