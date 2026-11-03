# Proposal

## Why

The frontend is feature-complete for the demo but has rough edges that judges and reviewers hit immediately: it does not work on a phone (three fixed panes, no touch pan), every route shares one browser title and no share preview, lists are mouse-only, and there is no page that explains where the numbers come from. All of these live entirely in `apps/web` and can ship without waiting on the open data issues (#25–#30).

**Contract:** none (C is read as-is; no derivation rule changes). **Issue:** none; this is frontend-only polish.

## What Changes

- Responsive layout: below 900 px the three panes collapse to one column with a Filters / View / Details switch; Explore supports touch drag and pinch zoom.
- Per-route `document.title`, a static meta description, Open Graph tags and a canonical URL.
- Keyboard access: every row, dot and chip that opens a profile, issue or bill is reachable by Tab and activated by Enter/Space; visible focus ring; aria labels on icon buttons and search; skip link; `prefers-reduced-motion` disables fly-to and ring tweens.
- Remove the dead "focus" view code and its CSS.
- New `#/about` route: methodology (five files, score / direction / flip / heat rules quoted from `packages/contract/derived.md`), data snapshot date from the loaded records, AI disclosure, repo link; linked from masthead and the Explore side pane.
- Shareable Explore state in the hash query (`#/explore?state=CA&com=…&party=D&q=…`), restored on load.
- "Download CSV" on the Legislators table (filtered rows) and on a profile (the member's stances), generated in the browser.
- Empty states: profile with no speech rows says so; issue with no conditions hides the block with a one-line note.
- Print stylesheet for profile and bill pages.
- Defer the D3 script; confirm the ZIP table loads only on a numeric query; drop unreferenced logo sizes from the deploy.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-app`: new requirements for responsive layout, per-route titles and share metadata, keyboard access, the About page, shareable Explore state, CSV export, empty states and print; Explore view requirement gains touch input.

## Impact

- `apps/web/index.html` (all items), `apps/web/assets/logo/` (unreferenced sizes removed), `.github/workflows/pages.yml` only if the assembled `_site` needs the logo filter.
- No change to `data/`, `services/`, `packages/contract/`, `apps/web/lib/derive.mjs` or `apps/web/build/graph.mjs`. Validator output unchanged.
- Implementation by Muse Code, one commit per item, Claude pushes.
