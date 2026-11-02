# Design

## Context

See proposal.md — Why. `apps/web/index.html` is one file (≈1,100 lines): loader, model (EDGES aggregation per derived.md), four views + bill page, D3 force graph on SVG. The agreed look and behaviour live in local mocks (`data/_site/search-sample.html` is the master: Explore E + search + minimap + Issues directory/halo + Bills; `data/_site/bill-page.html` is already implemented in the app). The published prototype https://claude.ai/artifact/GhzJuPDAYqTkEt7PeaXFmY runs those mocks on the real data.

Constraints from Kurt: implemented by Muse Code (trailer `Co-Authored-By: Muse Code <noreply@meta.com>`); OpenSpec; nothing under `data/`, `services/`, `packages/contract/` changes; scoring rules unchanged.

## Goals / Non-Goals

Goals: interactive at real scale; a member findable in two keystrokes; issue page that reads with bimodal scores; bills reachable from the nav; zero contract change.

Non-Goals: changing scores, thresholds, flip or heat (a separate change after the `kind` contract issue); `bills.json` metadata (status, last action); effects/animations beyond the open/close tween and fly-to; removing Find or Legislators tabs.

## Decisions

1. **Derived cache, not a contract file.** `graph.json` is written by `apps/web/build/graph.mjs` from the contract-B files using the very same aggregation code path as the browser (the script imports the aggregation function; the page falls back to it when the cache is absent). It lives only in `_site/data/` at deploy and is gitignored locally. Shape: `{ meta, committees:[{id,name}], issues:[[name, comIdx, id]], people:[[name, party, state, district, id]], edges:[[pIdx, iIdx, score, heat, flip, n, kind[7]]], bills:[[iIdx, billString, n]] }`. Keeping it a cache (never hand-edited, regenerated every deploy) is why it is not a contract change.
2. **Lazy statements.** `stances.json` is fetched after first paint; views that need quotes (profile tabs, evidence cards, bill page, conditions quotes) await it and show a short "loading statements…" placeholder meanwhile. Explore, Issues directory/halo and Bills never need it.
3. **Canvas renderer with the existing encodings.** The D3 force simulation is dropped for Explore; layout is deterministic (ring + sector packing), so the picture is stable across loads. The SVG graph code is removed, not kept behind a flag. The bill page keeps its own SVG (small).
4. **Sector packing.** Per member: strongest committee by attention-weighted edges (`.3 + heat`), second strongest for ordering within the sector; sector span ∝ `0.55 + 0.9 · count/avg`, opened sector ≥ `max(2.2× its base, 0.5 × its issue count)`; radius = `R · (0.14 + 0.74·√rank)` where rank is the percentile of specialisation (share of attention in the top committee). This is what `search-sample.html` does; port it, do not redesign it.
5. **Action-kind inference lives in one function** (`kindOf(statement)`), used by the halo and the Bills count; delete it when the contract gets `kind`.
6. **Routing.** Add `#/issue/<id>`; keep `#/legislator/<id>` and `#/bill/<id>`; the Issues tab with no id shows the directory. Bare hash tokens only.
7. **ZIP table.** `apps/web/assets/zip-to-district.json` built once from the Census ZCTA↔CD relationship file (119th Congress districts); for this change ship the table with at least every ZIP that appears in the top 100 US cities plus a `README` line on how it was built. Multi-district ZIPs map to arrays.
8. **Minimap tile grid** is a constant table (state → column,row), copied from the mock.

## Risks / Trade-offs

- [One huge file gets bigger] → group new code under clear headers (`// ===== search`, `// ===== explore (canvas)`, `// ===== issues`, `// ===== bills`, `// ===== minimap`); delete the SVG Explore and the old focus view in the same change.
- [graph.json and browser derivation drift] → the build script `import`s the aggregation from a tiny shared module `apps/web/lib/derive.mjs` that index.html also inlines by copy; a test compares both outputs on `data/`.
- [Artifact/host lays out late] → size Canvas via ResizeObserver, rebuild on real size changes (ported from the mock).
- [Bimodal scores make party bars look one-sided] → that is the data (see audit); the halo shows actions, not a fake spectrum.

## Migration Plan

Sections, each a Muse Code run + verify + commit: (1) build script + workflow + loader + lazy statements; (2) search + Explore Canvas + fly-to + minimap; (3) Issues directory + issue page + Bills tab + routes; (4) verification on real data, Pages deploy. Rollback: revert the commits; data untouched.

## Open Questions

- Whether Find and Legislators stay as separate tabs once search exists (keep for now).
- Full national ZIP table size (≈33k ZIPs ≈ 600 KB): ship partial now, full table later.
