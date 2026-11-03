# web-app (delta)

## ADDED Requirements

### Requirement: Bills file loading

The app SHALL fetch `bills.json` next to the other data files when it exists; when the fetch fails the app SHALL behave as if no bill carries a question. A bill record with `short_context` and `binary_question` SHALL be available to Explore, the Bills tab and the bill page by `bill_id`.

#### Scenario: File absent

WHEN `bills.json` returns 404 THEN Explore SHALL draw no bill nodes and the side pane SHALL show no match list, and every other view SHALL render as before.

### Requirement: Match in Explore

In Explore, an opened committee sector SHALL show that committee's bills that carry a `binary_question` as square nodes; clicking one SHALL show in the side pane the bill number, title, `short_context`, the question and its two options plus Skip. Answering SHALL store the choice per `bill_id` in browser storage, colour the bill node by the answer, light each member dot by that bill's recorded position relative to the answer (agree / disagree / no record), and show `n answered` in the HUD. After three or more answers the side pane SHALL show a ranked match list (agreement share over answered bills with a record, minimum overlap selectable, filters for state and party, closest and farthest halves, rows open profiles, one-line rule) and a summary built only from the stored answers and bill fields.

#### Scenario: Answer lights the ring

WHEN the user answers Yes on a bill THEN members recorded as supporting it SHALL be drawn in the support colour, members recorded as opposing in the oppose colour, and members without a record dimmed, until another bill is selected.

#### Scenario: Board after three answers

WHEN the user has answered three bills THEN the side pane SHALL list members with a record on at least the chosen minimum of those bills, ranked by agreement share, and a member with 2 of 3 agreeing SHALL show 67% · 2/3.

#### Scenario: Summary without tradeoffs

WHEN bill options carry no `tradeoff` text THEN the summary SHALL state the count answered, the side taken most often and the committees involved, and SHALL not invent trade-off text.

#### Scenario: Answers persist

WHEN the user reloads the page THEN previously stored answers SHALL be restored and the HUD count SHALL match.

## MODIFIED Requirements

### Requirement: Explore view

Explore SHALL render on a Canvas: committees on a fixed ring whose sector widths are proportional to the number of members whose strongest committee they are; clicking a committee SHALL open it in place (its sector widens and its issues appear on the ring, together with the committee's bills that carry a question) and clicking again SHALL collapse it; each member SHALL sit inside the sector of their strongest committee at a radius set by the percentile rank of their specialisation; by default each member's K strongest edges SHALL be drawn (K user-adjustable 1–5, default 2); hovering or pinning any node SHALL draw all of that node's edges and dim the rest; the view SHALL support wheel zoom, drag pan, touch drag and pinch, show member names when zoomed past 2.4× or matched by search, and offer D/R filters. Edge colour, width, opacity and dash SHALL follow the existing encoding. Node fill SHALL encode party only.

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

WHEN the opened committee has four bills with a `binary_question` THEN four square bill nodes SHALL appear in the sector and the issue nodes SHALL remain.
