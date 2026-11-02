# web-app

## Purpose

The zero-build frontend in `apps/web/index.html` implements contract C: it loads the five contract-B files at startup, derives per-(person, issue) edges and per-legislator stats in the browser, and renders the four views (Explore, Issues, Find, Legislators/profile) with deep links. This spec freezes that behaviour as implemented today.

## Requirements

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

### Requirement: Edge derivation from statements

For each (person, issue) pair the browser SHALL derive one edge: `score` as the confidence-weighted mean of statement scores (weights low 0.4, mid 0.7, high 1, super_high 1.2); `direction` from that score (> 0.15 support, < −0.15 oppose, else neutral); `n` as the statement count; `first`/`last` as the date range; `flip` true when the set of non-neutral statement directions has more than one member (neutral → support is NOT a flip); `linkage`/`llm_confidence` as the maximum across statements; `quote`/`bill`/`source` from the latest statement as headline evidence.

#### Scenario: Weighted score

WHEN an edge has scores +1.0 (low) and −1.0 (super_high) THEN the derived score SHALL be negative (the higher-confidence statement dominates).

#### Scenario: Neutral excursion is not a flip

WHEN a legislator's statements on an issue are neutral then support THEN `flip` SHALL be false.

#### Scenario: Support-to-oppose is a flip

WHEN a legislator's non-neutral statements on an issue include both support and oppose THEN `flip` SHALL be true and the edge SHALL render dashed.

### Requirement: Salience and heat

Each edge SHALL carry `salience` = Σ `2^(−age_days / 180)` over its statements (half-life 180 days; age relative to today, or relative to the newest statement for stable mock demos) and `heat` = percentile rank of salience across all edges in 0…1. All sources are official records, so there SHALL be no venue weighting.

#### Scenario: Recent edge outranks old edge

WHEN two edges have equal statement counts but one is newer THEN the newer edge SHALL have higher salience and equal-or-higher heat.

### Requirement: Per-legislator derived stats

For each legislator the browser SHALL derive `decisiveness` (mean of |edge score| across their issues), `vs own party` (mean over issues of |score − mean score of other same-party members on that issue|, over issues where such a mean exists), and `flipped` (count of edges with `flip`).

#### Scenario: Lone voice scores high divergence

WHEN a legislator is the only same-party member with an edge on an issue THEN that issue SHALL be excluded from their `vs own party` mean.

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

### Requirement: Find view

The Find (list) view SHALL render one row per edge with dropdown filters, sortable columns, and CSV export.

#### Scenario: CSV export matches rows

WHEN the user applies a filter then exports THEN the CSV SHALL contain exactly the filtered edges.

### Requirement: Legislators profile view

The Legislators view SHALL render a profile with hero + stat strip, an AI summary with clickable citation numbers opening the quoted statement (or "not generated yet" when the summary or file is missing), an Overview tab (attention map x=score y=salience, fingerprint radar), an Issues-by-committee tab (diverging bars, party-average tick, attention dot, ribbon), a Timeline tab (all statements across issues on one time axis), and, when the conditions ledger holds rows for the legislator, a "Conditions" block listing each row as a stance-first sentence with bill, demand type and quote.

#### Scenario: Missing summary placeholder

WHEN a legislator has no entry in `summaries.json` THEN the profile SHALL show "not generated yet" instead of a summary.

#### Scenario: Citation opens evidence

WHEN the user clicks a summary citation number THEN the quoted statement SHALL open.

#### Scenario: Legislator without conditions

WHEN the ledger has no rows for the legislator THEN the "Conditions" block SHALL not render.

### Requirement: Profile deep link

Every legislator SHALL have a deep link `#/legislator/<id>`; loading that hash SHALL open the profile directly, `hashchange` to it SHALL navigate there, and leaving profile mode SHALL clear the hash.

#### Scenario: Direct link load

WHEN the page loads with `#/legislator/p04` THEN the profile for `p04` SHALL render without further clicks.

### Requirement: Click-to-profile from graph

Clicking a legislator node in the Explore graph or the "Open profile" button beside evidence SHALL navigate to that legislator's profile and update the URL hash.

#### Scenario: Node click navigates

WHEN the user clicks a person node in the graph THEN state SHALL switch to profile mode with the hash set to `#/legislator/<id>`.

### Requirement: Frontend non-goals

The frontend SHALL never call a model, never rewrite a quote, never hide a flip, and never merge two issues. Any derived rule needing a new input SHALL require a contract-B change with a `contract`-labelled issue.

#### Scenario: Quote rendered verbatim

WHEN an evidence panel shows a quote THEN the text SHALL equal the `quote` field from `stances.json` byte-for-byte.

### Requirement: Conditions file loading

The app SHALL attempt to load `conditions.json` from the same data location as the other files, treat a missing file or a fetch failure as an empty ledger, and never block rendering on it.

#### Scenario: File absent

WHEN `conditions.json` returns 404 THEN every view SHALL render as before with no conditions elements.

### Requirement: Existing edge encoding unchanged

Adding the conditions ledger SHALL NOT change edge colour, width, opacity or dash rules; edges SHALL always show the legislator's current stance.

#### Scenario: Edge with a condition

WHEN an edge carries a condition THEN its colour, width, opacity and dash SHALL equal those it would have with no ledger loaded.

### Requirement: Condition marker on edges

In Explore, an edge whose (person, issue) has at least one condition row SHALL show a ◆ marker at its midpoint. Hovering the marker SHALL show each condition as a stance-first sentence (current stance, then "would accept passage / would support / would turn against it / will withhold the final-passage vote" and the demand) with its quote.

#### Scenario: Opposing legislator with a support-if-met condition

WHEN the hovered legislator currently opposes and their condition has `stance_if_met: support` THEN the tooltip SHALL read "opposes now · would accept passage if <demand>".

### Requirement: Issue panel grouped by bill

When the user selects an issue in Explore and the ledger holds rows for it, the side panel SHALL list that issue's bills (from statements and condition rows), each with its demand chips; hovering a chip SHALL highlight only the edges of the legislators who stated it, without adding glyphs or labels to the graph. Each bill SHALL link to its bill page, and the panel SHALL offer "Open issue page →" to `#/issue/<id>`.

#### Scenario: Two bills under one issue

WHEN an issue has conditions on two different bills THEN the panel SHALL show two bill groups, each with only its own chips.

#### Scenario: Open issue page from Explore

WHEN the user clicks "Open issue page →" THEN the location SHALL become `#/issue/<id>` and the issue page SHALL render.

### Requirement: Bill page

The app SHALL serve `#/bill/<bill id>` (bill id = lower-case letters and digits of the bill number, e.g. `hr6110`) with a header, a current-stance strip and spectrum for legislators with statements on that bill, and a negotiation map: demand nodes, one edge per condition coloured by `stance_if_met`, amendment toggles that respect `excludes`, a projected label per legislator (YES / NO / UNKNOWN, plus "was …" when it changes), and a who-moves list naming only legislators whose projection changes.

#### Scenario: Exclusive demands

WHEN the user ticks a demand that another demand `excludes` THEN the excluded demand's toggle SHALL be disabled with an explanation.

#### Scenario: Projection change shown

WHEN a ticked demand flips a legislator's projection THEN their label SHALL change colour and text and show "was <previous>".

### Requirement: Party and stance colours never share a node

Legislator node fill SHALL encode party only; projected stance on the bill page SHALL be shown as a text label beside the node, never as a node colour or ring.

#### Scenario: Republican projected to oppose

WHEN a Republican legislator is projected NO THEN the node SHALL stay the party colour and a red "NO" label SHALL appear under the name.

### Requirement: Legislator click opens profile

Clicking a legislator node in Explore, the Issues view or the bill page SHALL open that legislator's profile.

#### Scenario: Click on bill page

WHEN the user clicks a legislator node on a bill page THEN the location SHALL become `#/legislator/<id>`.

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
