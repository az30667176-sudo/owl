# Proposal

## Why

Every bill page should look the same: the bill on the left, lines going out to where the votes are. Today a bill with no condition rows gets a whip bar and a note while a bill with conditions gets the what-if map, so the two kinds of page do not read as one product. The user wants one map for all bills: without what-ifs, two lines — Support and Oppose — each ending in a node with an expandable roster; with what-ifs, the legislators who stated conditions get their own forked lines through the demand nodes, and everyone else still lands in the Support / Oppose nodes.

**Contract:** none. **Issue:** none; frontend-only.

## What Changes

- The negotiation map is drawn for every bill. Fixed layout: bill node left (as today); demand (what-if) nodes in the middle column when the bill has condition rows; right column = individual rows for legislators with a condition, a speech, or who move under the ticks (as today), followed by two aggregate nodes **Support · n** and **Oppose · n** (and **Not clear · n** only when n > 0) that collect everyone else by projection.
- Aggregate nodes: a party-split bar inside the node (D / R / I counts), one line from the bill coloured support / oppose, and a disclosure control that expands a roster directly under the map: party dot · name · seat · score, first 20 then "Show all n"; every row opens `#/legislator/<id>`; keyboard-reachable.
- Ticking a demand moves people between the individual rows and the aggregate nodes exactly as projections change; the counts update.
- The whip-count bar and its caption stay above the map as the summary; the "No conditions on record…" note is dropped (the map now says it: no demand column, two lines). The spectrum columns under the spectrum are removed on every bill (the rosters replace them).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-app`: Bill page requirement — one map for all bills with Support / Oppose aggregate nodes and expandable rosters; what-if forks only for legislators with conditions.

## Impact

- `apps/web/index.html` only (`renderBill`, the billmap SVG builder, roster HTML + CSS). Nothing under `data/`, `services/`, `packages/`, `apps/web/lib/`, `apps/web/build/`. Implementation by Muse Code.
