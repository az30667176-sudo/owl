# web-app (delta)

## MODIFIED Requirements

### Requirement: Bill page

The app SHALL serve `#/bill/<bill id>` (bill id = lower-case letters and digits of the bill number, e.g. `hr6110`) with a header, a current-stance strip and spectrum for legislators with statements on that bill, and a "What it would take" section. The spectrum SHALL stack at most 12 dots per score and show a count above taller columns, keeping its height at or under 160 px, and SHALL state how positions were formed ("N cosponsored · N spoke · N voted"). The section SHALL open with a whip-count bar of the projection as written (YES / NO / UNKNOWN split by party, plus a muted "not on record" segment) captioned `YES n · NO n · UNKNOWN n · <majority> needed · ±k`, followed on every bill by one negotiation map: the bill node on the left; demand nodes with amendment toggles that respect `excludes` when the bill has condition rows; individual rows for legislators who stated a condition, spoke on the bill, or move under the current ticks (party dot, name, one clause, projected label with "was …" when it changes, one edge per condition coloured by `stance_if_met`); and aggregate nodes Support · n and Oppose · n (Not clear · n only when non-empty) that collect every other legislator by projection, each with a party split, one line from the bill, and an expandable roster (party dot · name · seat · score, first 20 then "Show all n") whose rows open that legislator's page. No label SHALL be clipped. A who-moves list SHALL name only legislators whose projection changes.

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

WHEN a bill has 60 legislators of whom 4 stated conditions and 3 spoke THEN the map SHALL draw those 7 as individual rows and the remaining 53 in the aggregate nodes, and ticking a demand that moves an aggregated legislator SHALL promote that legislator to an individual row and decrement the aggregate.
