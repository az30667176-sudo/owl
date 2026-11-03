# Proposal

## Why

The grouped negotiation map from `bill-page-scale` is correct but ugly on the common case: a bill with no conditions renders three large party circles with lines from a box and 400 px of empty space, and labels clip at the right edge. A bill with nothing in the conditions ledger has nothing to negotiate, so a node-link map is the wrong picture; a whip count is the right one.

**Contract:** none. **Issue:** none; frontend-only.

## What Changes

- "What it would take" opens with a **whip-count bar**: one stacked horizontal bar of the projection as written — YES by party (D / R / I segments), NO by party, UNKNOWN, and a muted "not on record" segment for the rest of the chamber — with a mono caption `YES n · NO n · UNKNOWN n · 218 needed · ±k` (218 = House majority; use 51 when the bill id starts with `s`).
- **No conditions on the bill:** the map is not drawn. A one-line note replaces it: "No conditions on record for this bill, so nobody moves. The negotiation map appears once the conditions ledger has rows for it."
- **Conditions exist:** the map is drawn under the bar with only individual nodes for legislators who stated a condition, spoke on the bill, or move under the current ticks; each row is a small party-coloured dot, the name, and one short clause from their condition (or their projection when they only spoke); all others collapse into one bottom row "N others unchanged · a D YES · b R NO · list" that opens the list in the side pane. No node label may be clipped: text is truncated with an ellipsis to fit the SVG width.
- The large group circles are removed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-app`: the Bill page requirement's negotiation-map rules change (whip-count bar; map only with conditions; single "others" row).

## Impact

- `apps/web/index.html` only (`renderBill`, the billmap SVG builder, CSS for the bar). Nothing under `data/`, `services/`, `packages/`, `apps/web/lib/`, `apps/web/build/`. Implementation by Muse Code.
