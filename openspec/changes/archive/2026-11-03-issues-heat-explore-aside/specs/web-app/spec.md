# web-app (delta)

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Explore aside

The Explore left pane SHALL contain, in order: "Hottest issues · 90 days" (the eight issues with the highest heat, each with a 12-month statements-per-month sparkline once statements are loaded and its active-member count; clicking a row opens that issue's committee on the ring and lights the issue's edges; an "all 187 →" link opens the directory); "Recent changes · 30 days" (up to eight lines: speech-only flips and condition rows, newest first, each naming the member and issue with ⟲ or ◆ and the date; clicking a line flies to the member); a State chip bound to the same state as the minimap; and the existing stat line. It SHALL NOT contain a search box, issue checkboxes, stance chips or confidence chips. Ring, edges, HUD, side pane and hash query behaviour SHALL be unchanged.

#### Scenario: Hot issue click

WHEN the user clicks "Defense Authorization" in the hottest list THEN the Armed Services sector SHALL open on the ring, the issue's edges SHALL be highlighted, and the hash query SHALL carry `com=<armed services id>`.

#### Scenario: Recent change click

WHEN the user clicks a flip line for a member THEN Explore SHALL fly to that member's node as the search result click does.

#### Scenario: Statements not yet loaded

WHEN `stances.json` has not arrived THEN the hottest list SHALL render from the graph cache without sparklines and SHALL add them when statements arrive.
