# web-app (delta)

## MODIFIED Requirements

### Requirement: Bill page

The app SHALL serve `#/bill/<bill id>` (bill id = lower-case letters and digits of the bill number, e.g. `hr6110`) with a header, a current-stance strip and spectrum for legislators with statements on that bill, and a negotiation map: demand nodes, one edge per condition coloured by `stance_if_met`, amendment toggles that respect `excludes`, a projected label per legislator (YES / NO / UNKNOWN, plus "was …" when it changes), and a who-moves list naming only legislators whose projection changes. The spectrum SHALL stack at most 12 dots per score and show a count above taller columns, keeping its height at or under 160 px, and SHALL state how positions were formed ("N cosponsored · N spoke · N voted"). The negotiation map SHALL draw individual nodes only for legislators who stated a condition, spoke on the bill, or move under the current ticks (at most 40), and SHALL collapse all others into group nodes keyed by projection and party with a count.

#### Scenario: Exclusive demands

WHEN the user ticks a demand that another demand `excludes` THEN the excluded demand's toggle SHALL be disabled with an explanation.

#### Scenario: Projection change shown

WHEN a ticked demand flips a legislator's projection THEN their label SHALL change colour and text and show "was <previous>".

#### Scenario: Cosponsor-only bill

WHEN a bill has 314 legislators all at +0.80 with no conditions and no speech THEN the spectrum SHALL show one column of 12 dots with a "314" count, the kind line SHALL read "314 cosponsored · 0 spoke · 0 voted", and the negotiation map SHALL contain only group nodes (one per party present) with no individual rows.

#### Scenario: Mixed bill

WHEN a bill has 60 legislators of whom 4 stated conditions and 3 spoke THEN the map SHALL draw those 7 as individual nodes and the remaining 53 as group nodes, and ticking a demand that moves a grouped legislator SHALL promote that legislator to an individual node.
