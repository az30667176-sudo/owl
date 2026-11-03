# web-app (delta)

## MODIFIED Requirements

### Requirement: Match in Explore

In Explore, clicking an issue node in an opened sector SHALL list, in the side pane, that issue's bills that carry a `binary_question`, one row each with the bill number, the question and Yes / No toggles; answering SHALL store the choice per `bill_id` in browser storage, mark the toggle, light each member dot by the last answered bill's recorded position relative to the answer (agree / disagree / no record), and show `n answered` in the HUD. With three or more answers the side pane SHALL also show, under the questions, a ranked match list (agreement share over answered bills with a record, minimum overlap selectable, filters for state and party, closest and farthest halves, rows open profiles, one-line rule). With one or more answers a summary strip SHALL appear under the Explore canvas, built only from stored answers and bill fields. The ring SHALL carry no bill nodes.

#### Scenario: Questions under an issue

WHEN the user clicks the "Defense Authorization" issue node and two bills under it carry questions THEN the side pane SHALL show two question rows with Yes / No toggles above the issue's existing block.

#### Scenario: Answer lights the ring

WHEN the user answers Yes on a bill THEN members recorded as supporting it SHALL be drawn in the support colour, members recorded as opposing in the oppose colour, and members without a record dimmed, until another bill is answered or answers are cleared.

#### Scenario: Board after three answers

WHEN the user has answered three bills THEN the side pane SHALL list members with a record on at least the chosen minimum of those bills, ranked by agreement share, and a member with 2 of 3 agreeing SHALL show 67% · 2/3.

#### Scenario: Summary strip

WHEN the user has answered at least one bill THEN a strip under the canvas SHALL read the count answered, the side taken most often, the committees involved and the majority-agreement count, and SHALL show trade-off lines only from a `tradeoff` field.

#### Scenario: Summary without tradeoffs

WHEN bill options carry no `tradeoff` text THEN the summary strip SHALL state the count answered, the side taken most often and the committees involved, and SHALL not invent trade-off text.

#### Scenario: Answers persist

WHEN the user reloads the page THEN previously stored answers SHALL be restored and the HUD count SHALL match.

### Requirement: Explore view

Explore SHALL render on a Canvas: committees on a fixed ring whose sector widths are proportional to the number of members whose strongest committee they are; clicking a committee SHALL open it in place (its sector widens and its issues appear on the ring) and clicking again SHALL collapse it; each member SHALL sit inside the sector of their strongest committee at a radius set by the percentile rank of their specialisation; by default each member's K strongest edges SHALL be drawn (K user-adjustable 1–5, default 2); hovering or pinning any node SHALL draw all of that node's edges and dim the rest; the view SHALL support wheel zoom, drag pan, touch drag and pinch, show member names when zoomed past 2.4× or matched by search, and offer D/R filters. Edge colour, width, opacity and dash SHALL follow the existing encoding. Node fill SHALL encode party only.

#### Scenario: Open a committee in place

WHEN the user clicks a committee on the ring THEN that sector SHALL widen to show its issues and the other sectors SHALL compress without the rest of the layout jumping.

#### Scenario: Default edge budget

WHEN no node is hovered or pinned and K = 2 THEN at most 2 edges per member SHALL be drawn.

#### Scenario: Flip visible in graph

WHEN an edge has `flip` true THEN its link SHALL render dashed in Explore.

#### Scenario: Real-scale performance

WHEN the real data (≈8,600 edges, 451 members) is loaded THEN hovering a committee SHALL redraw at interactive frame rates on a laptop (no visible stall).

#### Scenario: Touch pan

WHEN one finger drags across the Canvas THEN the ring SHALL pan with the finger and the page SHALL not scroll.

#### Scenario: Bills in an opened sector

WHEN the opened committee has four bills with a `binary_question` THEN the ring SHALL show only the issue nodes (no bill nodes) and the bills SHALL be reachable through their issue's question list in the side pane.
