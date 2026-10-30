# Spec Delta

## MODIFIED Requirements

### Requirement: Legislators profile view

The Legislators view SHALL render a profile with hero + stat strip, an AI summary with clickable citation numbers opening the quoted statement (or "not generated yet" when the summary or file is missing), an Overview tab (attention map x=score y=salience, fingerprint radar), an Issues-by-committee tab (diverging bars, party-average tick, attention dot, ribbon), a Timeline tab (all statements across issues on one time axis), and, when the conditions ledger holds rows for the legislator, a "Conditions" block listing each row as a stance-first sentence with bill, demand type and quote.

#### Scenario: Missing summary placeholder

WHEN a legislator has no entry in `summaries.json` THEN the profile SHALL show "not generated yet" instead of a summary.

#### Scenario: Citation opens evidence

WHEN the user clicks a summary citation number THEN the quoted statement SHALL open.

#### Scenario: Legislator without conditions

WHEN the ledger has no rows for the legislator THEN the "Conditions" block SHALL not render.

## ADDED Requirements

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

When the user selects an issue in Explore and the ledger holds rows for it, the side panel SHALL list that issue's bills (from statements and condition rows), each with its demand chips; hovering a chip SHALL highlight only the edges of the legislators who stated it, without adding glyphs or labels to the graph. Each bill SHALL link to its bill page.

#### Scenario: Two bills under one issue

WHEN an issue has conditions on two different bills THEN the panel SHALL show two bill groups, each with only its own chips.

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
