# explore-heat-edges

## Why
Kurt (2026-11-04): an Explore line joins a member to a whole committee or topic, which holds many unrelated bills, so it has no meaningful "for" or "against". Colouring it green/red reads as a stance the member never took. The line should only show how much attention the member gives that topic. Also the masthead search box sits at the far right; it belongs in the middle of the bar.

## What changes
- Explore ring edges: one colour for every line (no support / oppose / neutral colouring, no dashed "changed direction" style). Thickness and brightness come from attention (heat) only: more and more recent statements = thicker and brighter. Focused lines (hover / pin) stay strong; unfocused lines stay faint.
- Explore toolbar legend: replace Support / Oppose / Neutral / Changed direction with one item, "Line: thicker and brighter = more attention (recent statements count more)".
- Member hover tooltip on the ring: list the top topics by attention with a small attention figure (percentile) instead of a signed score in green/red.
- Masthead: the "Find a legislator" search box is centred in the bar (between the nav and the right-hand crumb), not pushed to the right edge.

## Out of scope
Scores, flips and stance colours elsewhere (profile, topic page, bill page, match drawer, the state map's stance mode) are unchanged. No data or contract change.
