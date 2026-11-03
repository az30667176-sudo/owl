# Proposal

## Why

The Issues directory colours every issue by support / neutral / oppose, but an issue is not something you support or oppose: bills under one issue pull in opposite directions, and 88% of the rows behind those bars are sponsorship and votes with hard-coded scores. The bars read as fact while meaning almost nothing. The Explore left pane repeats the issue list as 187 checkbox chips nobody uses to hide anything, plus a search box the masthead already provides. Both panels should answer "where is the activity right now".

**Contract:** none (C read as-is; a derived `issue heat` is computed from existing edge salience). **Issue:** none; frontend-only.

## What Changes

- **Issues directory**: each issue row shows a heat bar (percentile of the issue's summed edge salience, three brightness steps) and `n active · m bills`; committees keep their order, issues inside a committee sort by heat; a "Hottest now" chip row at the top lists the five hottest issues and opens their pages. The support / neutral / oppose bar is removed from the directory. The issue page itself is unchanged.
- **Explore left pane** replaced by three blocks: *Hottest issues · 90 days* (top 8 by heat, a 12-month statements-per-month sparkline when statements are loaded, active count; click = open that committee on the ring and light the issue's edges, "all 187 →" goes to the directory); *Recent changes · 30 days* (latest speech flips and condition rows, one line each, click = fly to the member); *State* chip (same value as the minimap). The search box, issue checkboxes, stance chips and confidence chips are removed from the pane; party stays in the HUD; the stat line stays at the bottom.
- Nothing else in Explore changes: ring, edges, colours, HUD, side pane, hash query (`state`, `party`, `k`, `q` keep working; `com` now set by the hottest-issue click).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-app`: Issues view requirement (directory shows heat, not stance); new Explore aside requirement.

## Impact

- `apps/web/index.html` only (`renderIssuesCenter` / `dirRows`, `renderExploreAside`, CSS). `filteredEdges()` keeps its logic with the removed filters at their defaults. Nothing under `data/`, `services/`, `packages/`, `apps/web/lib/`, `apps/web/build/`. Implementation by Muse Code.
