# Spec Delta

## MODIFIED Requirements

### Requirement: Data loading location

The app SHALL fetch `taxonomy.json`, `issues.json`, `people.json`, `stances.json`, and `summaries.json` relative to its own URL, probing `./data/` first and falling back to `../../data/`, and SHALL show a "Could not load data" message naming the failing file when a fetch fails. When `graph.json` (a derived cache of contract-C edges) is present next to the data files, the app SHALL load it and render Explore, Issues and Bills from it before `stances.json` has arrived, and SHALL fetch `stances.json` lazily for views that show quotes.

#### Scenario: Fallback data path

WHEN `./data/people.json` is not reachable but `../../data/people.json` is THEN the app SHALL load all files from `../../data/`.

#### Scenario: Load failure surfaces

WHEN a required file fetch fails THEN the loading indicator SHALL be replaced with an error naming the file.

#### Scenario: Graph cache present

WHEN `graph.json` loads THEN Explore SHALL be interactive before `stances.json` finishes loading, and the edges it draws SHALL equal those derived in the browser from `stances.json`.

#### Scenario: Graph cache absent

WHEN `graph.json` returns 404 THEN the app SHALL derive the same edges from `stances.json` and render identically.

### Requirement: Explore view

Explore SHALL render on a Canvas: committees on a fixed ring whose sector widths are proportional to the number of members whose strongest committee they are; clicking a committee SHALL open it in place (its sector widens and its issues appear on the ring) and clicking again SHALL collapse it; each member SHALL sit inside the sector of their strongest committee at a radius set by the percentile rank of their specialisation; by default each member's K strongest edges SHALL be drawn (K user-adjustable 1–5, default 2); hovering or pinning any node SHALL draw all of that node's edges and dim the rest; the view SHALL support wheel zoom and drag pan, show member names when zoomed past 2.4× or matched by search, and offer D/R filters. Edge colour, width, opacity and dash SHALL follow the existing encoding. Node fill SHALL encode party only.

#### Scenario: Open a committee in place

WHEN the user clicks a committee on the ring THEN that sector SHALL widen to show its issues and the other sectors SHALL compress without the rest of the layout jumping.

#### Scenario: Default edge budget

WHEN no node is hovered or pinned and K = 2 THEN at most 2 edges per member SHALL be drawn.

#### Scenario: Flip visible in graph

WHEN an edge has `flip` true THEN its link SHALL render dashed in Explore.

#### Scenario: Real-scale performance

WHEN the real data (≈8,600 edges, 451 members) is loaded THEN hovering a committee SHALL redraw at interactive frame rates on a laptop (no visible stall).

### Requirement: Issues view

The Issues tab SHALL show a directory: committees with their issues, each issue with a support/neutral/oppose bar and its member count, filterable by text. Clicking an issue SHALL open `#/issue/<id>`: a header and stance strip; an action halo (concentric half-rings, one per kind of action — sponsored, voted yea/nay, cosponsored, spoke for/against, signed dissenting views — right half = for, left half = against, one dot per member in party colour, hover shows the member's actions, click opens the profile); party split bars (all / D / R); strongest voices; a district tile map coloured by stance on the issue; the bills under the issue (link to `#/bill/<id>`); related issues (shared members) as chips that navigate.

#### Scenario: Directory bar

WHEN an issue has 10 supporting, 2 neutral and 4 opposing members THEN its directory bar SHALL be split in those proportions.

#### Scenario: Halo rings

WHEN a member voted nay and cosponsored on the same issue THEN they SHALL appear as a dot on the left of the vote ring and on the right of the cosponsor ring, and hovering either dot SHALL connect the two.

#### Scenario: Issue deep link

WHEN the location is `#/issue/<id>` on load THEN the issue page SHALL render directly.

#### Scenario: Spectrum tick opens profile

WHEN the user clicks a member dot on the halo (the successor of the spectrum tick) THEN the app SHALL open that legislator's profile.

### Requirement: Issue panel grouped by bill

When the user selects an issue in Explore and the ledger holds rows for it, the side panel SHALL list that issue's bills (from statements and condition rows), each with its demand chips; hovering a chip SHALL highlight only the edges of the legislators who stated it, without adding glyphs or labels to the graph. Each bill SHALL link to its bill page, and the panel SHALL offer "Open issue page →" to `#/issue/<id>`.

#### Scenario: Two bills under one issue

WHEN an issue has conditions on two different bills THEN the panel SHALL show two bill groups, each with only its own chips.

#### Scenario: Open issue page from Explore

WHEN the user clicks "Open issue page →" THEN the location SHALL become `#/issue/<id>` and the issue page SHALL render.

## ADDED Requirements

### Requirement: Global search

The masthead SHALL carry a search box focused by the `/` key that matches member name (substring), state (code or name), district (`CA-12`, at-large `XX-AL`) and 5-digit ZIP (via a static ZIP→district table shipped with the app). Results SHALL be grouped (ZIP, District, State, Name), show party colour, district and the member's strongest committee, support arrow keys and Enter, and a ZIP that spans several districts SHALL list every member.

#### Scenario: District query

WHEN the user types `CA-12` THEN the single member for that district SHALL be listed first.

#### Scenario: Enter opens profile

WHEN the user presses Enter on a result outside Explore THEN the location SHALL become `#/legislator/<id>`.

### Requirement: Fly to a member in Explore

Choosing a search result while Explore is shown SHALL zoom the Canvas to that member (about 3×), dim other members, draw only their edges, show their name and a side card with party, district, strongest committee, top issues and an "Open profile" action; clicking empty space SHALL restore the view.

#### Scenario: Fly from search

WHEN the user picks a result on Explore THEN the view SHALL animate to the member within one second and the side pane SHALL show their card.

### Requirement: Linked district minimap

The Explore side pane SHALL show a US tile map with one cell per district (states on a fixed grid). With no focus it SHALL colour cells by party; when an issue or committee is hovered or pinned it SHALL colour cells by that member's stance on it (support / oppose / neutral / no statement) and label the mode; hovering a cell SHALL highlight that member in the graph; clicking a cell SHALL fly to them; clicking a state label SHALL filter the graph to that delegation with a visible clear control.

#### Scenario: Recolour on issue focus

WHEN an issue is pinned THEN every member with a statement on it SHALL be coloured by stance and others SHALL be greyed, and the legend SHALL read "colour = stance on <issue>".

#### Scenario: State filter

WHEN the user clicks the TX label THEN only Texas members SHALL remain drawn in the graph until the filter is cleared.

### Requirement: Bills tab

The nav SHALL include a Bills tab listing every bill found in statements and conditions (number, title, committee › issue, statement count, ◆ condition count), filterable by number or title, newest/most-active first; a row SHALL open `#/bill/<id>`.

#### Scenario: Filter bills

WHEN the user types `6110` THEN only bills whose number or title contains it SHALL remain listed.

### Requirement: Action kind inference

Until the contract carries an action kind, the app SHALL infer each statement's kind in one isolated function: `model` = `owl-ingest-metadata` → sponsored (score ≥ 1) or cosponsored; `model` = `owl-ingest-rule` → signed views (rationale starts "Signed"), not voting (score 0), else vote yea/nay by sign; anything else → speech. Scores, directions, heat and flips SHALL NOT be altered by this inference; it only labels.

#### Scenario: Cosponsor row

WHEN a statement has `model: "owl-ingest-metadata"` and score 0.8 THEN it SHALL be labelled cosponsored and its score SHALL still count exactly as today.
