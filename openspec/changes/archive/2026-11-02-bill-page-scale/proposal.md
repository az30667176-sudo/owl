# Proposal

## Why

Bills with many cosponsors break the bill page on real data. H.R. 1262 has 314 legislators all at +0.80 and none with a speech or condition: the beeswarm stacks 314 dots into a 3,150 px column so the spectrum looks blank, and the negotiation map draws one 96 px row per legislator (≈30,000 px of identical "YES · now +0.80" cards). The page communicates nothing a count would not.

**Contract:** none (C read as-is). **Issue:** none; frontend-only.

## What Changes

- Spectrum: a score column stacks at most 12 dots; a taller column shows a count pill above it. Spectrum height is bounded (≤ 160 px). A kind line under the strip says how the positions were formed: "314 cosponsored · 0 spoke · 0 voted".
- Negotiation map: individual nodes only for legislators who stated a condition, spoke on the bill, or move under the current ticks; everyone else collapses into group nodes keyed by projection and party ("YES · 180 Democrats"). At most 40 individual nodes; beyond that, the remainder joins the groups with a "+N" link that lists them in the side pane. Map height is bounded by the number of drawn nodes.
- Columns under the spectrum are unchanged (15 + "more").

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-app`: the Bill page requirement gains scale rules for the spectrum and the negotiation map.

## Impact

- `apps/web/index.html` only (`renderBill`, the billmap SVG builder, CSS for the count pill and group node). No change to `data/`, `services/`, `packages/`, `apps/web/lib/`, `apps/web/build/`. Implementation by Muse Code.
