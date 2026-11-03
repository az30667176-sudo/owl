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

### Requirement: Issues view

The Issues tab SHALL show a directory: a "Hottest now" row of the five hottest issues, then committees with their issues sorted by heat, each issue with a heat bar (percentile of the issue's summed edge salience, three brightness steps) and `n active · m bills`, filterable by text; the directory SHALL show no support / neutral / oppose bar. Clicking an issue SHALL open `#/issue/<id>`: a header and stance strip; an action halo (concentric half-rings, one per kind of action — sponsored, voted yea/nay, cosponsored, spoke for/against, signed dissenting views — right half = for, left half = against, one dot per member in party colour, hover shows the member's actions, click opens the profile); party split bars (all / D / R); strongest voices; a district tile map coloured by stance on the issue; the bills under the issue (link to `#/bill/<id>`); related issues (shared members) as chips that navigate.

#### Scenario: Directory bar

WHEN an issue's summed salience ranks at the 92nd percentile among issues THEN its directory bar SHALL be 92% wide in the brightest step, and an issue below the 25th percentile SHALL use the dimmest step.

#### Scenario: Hottest now

WHEN the directory renders THEN the five issues with the highest heat SHALL appear as chips above the committees and clicking one SHALL open its issue page.

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

The app SHALL serve `#/bill/<bill id>` (bill id = lower-case letters and digits of the bill number, e.g. `hr6110`) with a header, a current-stance strip and spectrum for legislators with statements on that bill, and a "What it would take" section. The spectrum SHALL stack at most 12 dots per score and show a count above taller columns, keeping its height at or under 160 px, and SHALL state how positions were formed ("N cosponsored · N spoke · N voted"). The section SHALL open with a whip-count bar of the projection as written (YES / NO / UNKNOWN split by party, plus a muted "not on record" segment) captioned `YES n · NO n · UNKNOWN n · <majority> needed · ±k`, followed on every bill by one negotiation map: the bill node on the left; demand nodes with amendment toggles that respect `excludes` when the bill has condition rows; individual rows for legislators who stated a condition or move under the current ticks (party dot, name, one clause, projected label with "was …" when it changes, one edge per condition coloured by `stance_if_met`); and aggregate nodes Support · n and Oppose · n (Not clear · n only when non-empty) that collect every other legislator by projection, each with a party split, one line from the bill, and an expandable roster (party dot · name · seat · score, first 20 then "Show all n") whose rows open that legislator's page. No label SHALL be clipped. A who-moves list SHALL name only legislators whose projection changes.

#### Scenario: Exclusive demands

WHEN the user ticks a demand that another demand `excludes` THEN the excluded demand's toggle SHALL be disabled with an explanation.

#### Scenario: Projection change shown

WHEN a ticked demand flips a legislator's projection THEN their label SHALL change colour and text and show "was <previous>", and the aggregate counts SHALL update.

#### Scenario: Cosponsor-only bill

WHEN a bill has 314 legislators all at +0.80 with no conditions and no speech THEN the map SHALL show the bill node, no demand column, no individual rows, a Support · 314 node (180 D / 133 R / 1 I) and an Oppose · 0 node, and expanding Support SHALL list 20 rows with "Show all 314".

#### Scenario: Roster row opens profile

WHEN the user activates a roster row (click, or Enter on the focused row) THEN the location SHALL become `#/legislator/<id>` for that legislator.

#### Scenario: Bill with conditions

WHEN a bill has 60 legislators of whom 4 stated conditions THEN the map SHALL draw the demand column, those 4 as individual rows with forked condition edges, and the remaining 56 inside the Support / Oppose aggregate nodes, with no text past the SVG width.

#### Scenario: Mixed bill

WHEN a bill has 60 legislators of whom 4 stated conditions and 3 only spoke THEN the map SHALL draw those 4 as individual rows and the remaining 56 (the 3 speakers included) in the aggregate nodes, and ticking a demand that moves an aggregated legislator SHALL promote that legislator to an individual row and decrement the aggregate.

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

### Requirement: Responsive single-column layout

When the viewport is narrower than 900 px the app SHALL show one pane at a time — Filters, View or Details — selected by a three-way switch under the masthead, with View shown by default; the masthead SHALL keep the brand, the nav and the search box. No view SHALL require horizontal page scrolling.

#### Scenario: Phone width

WHEN the viewport is 375 px wide and Explore is open THEN the Canvas SHALL fill the width, the switch SHALL show Filters / View / Details, and choosing Details SHALL show the Explore side pane in place of the Canvas.

#### Scenario: Desktop unchanged

WHEN the viewport is 1200 px wide THEN the three panes SHALL render side by side exactly as today and the switch SHALL be hidden.

### Requirement: Touch input in Explore

On a touch device the Explore Canvas SHALL pan with one-finger drag and zoom with two-finger pinch, and a tap SHALL act as a click.

#### Scenario: Pinch zoom

WHEN two touch points move apart over the Canvas THEN the ring SHALL zoom about their midpoint, within the same zoom limits as the mouse wheel.

### Requirement: Per-route title and share metadata

The document title SHALL reflect the route: `OWL` for Explore, `Issues · OWL`, `Bills · OWL`, `Find · OWL`, `Legislators · OWL`, `<member name> · OWL`, `<issue name> · OWL`, `<bill number> · OWL`, `About · OWL`. The page SHALL carry a static meta description, Open Graph title / description / image / url and a canonical link pointing at the published site.

#### Scenario: Profile title

WHEN the location is `#/legislator/D000216` THEN `document.title` SHALL start with the member's name.

#### Scenario: Share preview

WHEN the page HTML is fetched by a link-preview bot THEN it SHALL contain `og:title`, `og:description` and an `og:image` that resolves to the owl mark.

### Requirement: Keyboard access

Every row, dot, chip or label that opens a profile, issue or bill SHALL be reachable with Tab and activated with Enter or Space, SHALL show a visible focus ring, and icon-only controls and the search box SHALL carry an accessible name. A skip-to-content link SHALL be the first focusable element. When `prefers-reduced-motion` is set, fly-to and ring open/close SHALL complete without animation.

#### Scenario: Tab through the legislators table

WHEN the user presses Tab on the Legislators view THEN focus SHALL move through the rows in order and Enter on a row SHALL open that member's profile.

#### Scenario: Reduced motion

WHEN the OS reduced-motion preference is on and the user clicks a search result in Explore THEN the view SHALL jump to the member without a tween.

### Requirement: About page

The route `#/about` SHALL render a methodology page stating: the six data files and what each holds; the score, direction, flip, salience and heat rules in the wording of `packages/contract/derived.md`; the data snapshot date (newest statement date) and record counts from the loaded files; an AI disclosure naming the scoring model and the coding assistant; and a link to the repository. The masthead SHALL link to it.

#### Scenario: Snapshot date is live

WHEN `data/stances.json` has a newest `date` of 2026-10-30 THEN the About page SHALL show "Data through 2026-10-30" and the statement, member and issue counts of the loaded files.

#### Scenario: Rules quoted, not reworded

WHEN the About page lists the direction thresholds THEN they SHALL read ±0.15 as in `derived.md`.

### Requirement: Shareable Explore state

Explore SHALL encode the selected state, committee filter, party filter, edge budget K and search text in the hash query (`#/explore?state=CA&com=<id>&party=D&k=3&q=<text>`), update it as filters change without adding history entries, and restore it on load.

#### Scenario: Restore from link

WHEN the app loads at `#/explore?state=CA&party=D` THEN the minimap state chip SHALL show CA, only Democrats SHALL be drawn, and the Filters pane SHALL reflect both.

#### Scenario: Clean default

WHEN all filters are at their defaults THEN the hash SHALL be `#/explore` with no query.

### Requirement: CSV export

The Legislators view SHALL offer "Download CSV" producing the currently filtered rows (name, seat, party, issue, committee, direction, score, statements, confidence, latest quote), and a profile SHALL offer "Download CSV" producing that member's statements (date, issue, bill, kind, direction, score, confidence, quote, source). Files SHALL be generated in the browser, UTF-8 with a header row, quotes verbatim.

#### Scenario: Filtered export

WHEN the Legislators table is filtered to 12 rows and the user clicks Download CSV THEN the file SHALL contain exactly 12 data rows.

### Requirement: Empty-state notes

A profile whose member has no speech-kind statement SHALL show, above the attention list, "No hearing statements yet — positions below come from sponsorship and votes." An issue with no condition rows SHALL hide the Conditions block and show "No conditions recorded for this issue."

#### Scenario: Votes-only member

WHEN a member's edges all have `spokeN == 0` THEN the profile SHALL show the no-statements note.

### Requirement: Print layout

Printing a profile or bill page SHALL hide the masthead, nav, Filters and Details panes, use a light background with dark text, and print every quote in full.

#### Scenario: Print profile

WHEN the user prints `#/legislator/<id>` THEN the output SHALL contain the hero, the attention list and the full quotes of the Timeline tab, and no navigation.

### Requirement: Explore aside

The Explore left pane SHALL contain, in order: "Hottest issues · 90 days" (the eight issues with the highest heat, each with a 12-month statements-per-month sparkline once statements are loaded and its active-member count; clicking a row opens that issue's committee on the ring and lights the issue's edges; an "all 187 →" link opens the directory); "Recent changes · 30 days" (up to eight lines: speech-only flips and condition rows, newest first, each naming the member and issue with ⟲ or ◆ and the date; clicking a line flies to the member); a State chip bound to the same state as the minimap; and the existing stat line. It SHALL NOT contain a search box, issue checkboxes, stance chips or confidence chips. Ring, edges, HUD, side pane and hash query behaviour SHALL be unchanged.

#### Scenario: Hot issue click

WHEN the user clicks "Defense Authorization" in the hottest list THEN the Armed Services sector SHALL open on the ring, the issue's edges SHALL be highlighted, and the hash query SHALL carry `com=<armed services id>`.

#### Scenario: Recent change click

WHEN the user clicks a flip line for a member THEN Explore SHALL fly to that member's node as the search result click does.

#### Scenario: Statements not yet loaded

WHEN `stances.json` has not arrived THEN the hottest list SHALL render from the graph cache without sparklines and SHALL add them when statements arrive.

### Requirement: Bills file loading

The app SHALL fetch `bills.json` next to the other data files when it exists; when the fetch fails the app SHALL behave as if no bill carries a question. A bill record with `short_context` and `binary_question` SHALL be available to Explore, the Bills tab and the bill page by `bill_id`.

#### Scenario: File absent

WHEN `bills.json` returns 404 THEN Explore SHALL draw no bill nodes and the side pane SHALL show no match list, and every other view SHALL render as before.

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
