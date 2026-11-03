# web-app (delta)

## ADDED Requirements

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

## MODIFIED Requirements

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
