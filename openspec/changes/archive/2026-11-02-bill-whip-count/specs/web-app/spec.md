# web-app (delta)

## MODIFIED Requirements

### Requirement: Bill page

The app SHALL serve `#/bill/<bill id>` (bill id = lower-case letters and digits of the bill number, e.g. `hr6110`) with a header, a current-stance strip and spectrum for legislators with statements on that bill, and a "What it would take" section. The spectrum SHALL stack at most 12 dots per score and show a count above taller columns, keeping its height at or under 160 px, and SHALL state how positions were formed ("N cosponsored · N spoke · N voted"). The section SHALL open with a whip-count bar of the projection as written (YES / NO / UNKNOWN split by party, plus a muted "not on record" segment) captioned `YES n · NO n · UNKNOWN n · <majority> needed · ±k`. When the bill has no condition rows the section SHALL show a one-line note and no map. When it has condition rows it SHALL draw a negotiation map with demand nodes, one edge per condition coloured by `stance_if_met`, amendment toggles that respect `excludes`, individual rows only for legislators who stated a condition, spoke on the bill, or move under the current ticks (each: party dot, name, one clause), a single "N others unchanged" row that lists them in the side pane, no clipped labels, a projected label (YES / NO / UNKNOWN, "was …" when it changes) and a who-moves list naming only legislators whose projection changes.

#### Scenario: Exclusive demands

WHEN the user ticks a demand that another demand `excludes` THEN the excluded demand's toggle SHALL be disabled with an explanation.

#### Scenario: Projection change shown

WHEN a ticked demand flips a legislator's projection THEN their label SHALL change colour and text and show "was <previous>".

#### Scenario: Cosponsor-only bill

WHEN a bill has 314 legislators all at +0.80 with no conditions and no speech THEN the spectrum SHALL show one column of 12 dots with a "314" count, the kind line SHALL read "314 cosponsored · 0 spoke · 0 voted", the whip-count bar SHALL show YES 314 split 180 D / 133 R / 1 I with a "not on record" remainder, the caption SHALL read `YES 314 · NO 0 · UNKNOWN 0 · 218 needed · +96`, and no map SHALL be drawn.

#### Scenario: Bill with conditions

WHEN a bill has 60 legislators of whom 4 stated conditions THEN the map SHALL draw those 4 as individual rows with a condition clause each and one "56 others unchanged" row, and no row's text SHALL extend past the SVG width.

#### Scenario: Mixed bill

WHEN a bill has 60 legislators of whom 4 stated conditions and 3 spoke THEN the map SHALL draw those 7 as individual rows and the remaining 53 in the "others" row, and ticking a demand that moves a grouped legislator SHALL promote that legislator to an individual row.
