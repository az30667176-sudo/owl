# nav-topics-legislators

## Why
Kurt (2026-11-04): the top bar has two tabs that both mean "people" (Find, Legislators) and calls the issue directory "Issues" where visitors expect "Topics". One people tab with the name search in its left bar is simpler.

## What changes
- Top bar becomes: Explore · Topics · Bills · Legislators · About.
- "Issues" is renamed "Topics" everywhere the visitor reads it (nav button, page crumbs and headings, left-pane headers, browser title, Explore links such as "all 187 →"). Routes stay `#/issue` and `#/issue/<id>`; ids, data and code identifiers do not change.
- The old Find tab (`#/find`, mode `list`) is renamed "Legislators". Its left bar gains, at the top, a "Legislator" search box (name, state or district, same matching as the old Legislators pane) that narrows the table rows to matching members; the existing dropdown filters stay below it.
- The old Legislators tab button is removed. `#/legislators` keeps working by redirecting to `#/find`. Profile pages `#/legislator/<id>` are unchanged (their left pane keeps the member directory) and highlight the Legislators tab.
- "← all legislators" style links go to `#/find`.

## Out of scope
No change to data, scoring, Explore, Bills, or the profile page body.
