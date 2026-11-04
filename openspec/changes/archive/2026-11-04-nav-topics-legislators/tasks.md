# Tasks (one commit)
- [x] Nav markup: buttons Explore Â· Topics (`m-issues`) Â· Bills Â· Legislators (`m-list`) Â· About; remove `m-profile` button and its onclick.
- [x] Rename visitor-facing "Issues"/"issues directory" text to "Topics" (nav, crumb `<b>Issues</b> Â· directory`, aside headers, page heading "All issues" â†’ "All topics", crumb links "Issues" on the single-issue page, `document.title` for issues/issue modes, Explore aside "all N â†’" link label if it says issues). Keep the words "issue"/"issues" where they describe a single policy issue inside sentences only if renaming would read wrong; prefer "topic".
- [x] Mode `list`: title "Legislators Â· OWL", crumb `<b>Legislators</b> Â· filter and compare`.
- [x] Mode `profile` (with or without a person) marks `m-list` active.
- [x] `#/legislators` route: redirect to `#/find` (replace hash).
- [x] `renderListAside`: add a text input id `l-q` at the top ("Legislator", placeholder "name, state or districtâ€¦"), stored in `state.l.q`; `listRows()` keeps only rows whose member matches (name contains, state equals, or district contains, case-insensitive). Typing keeps focus/caret (re-render the table and keep the input, do not rebuild the aside on each keystroke). "Reset filters" clears it too.
- [x] "â† all legislators" button in the Explore person card stays as is (it returns to the Explore list); any link that navigated to `#/legislators` now uses `#/find`.
