# Contract C — what the frontend derives from contract B

These rules live in `apps/web/prototype/index.html` (and will move to the production app unchanged). They are documented here so the process team knows what the UI will do with their rows, and so nobody pre-computes them upstream.

## Edge = one (person, issue) pair

For all statements with the same `person` and `issue`, sorted by `date`:

| derived field | rule |
|---|---|
| `score` | weighted mean of statement scores, weights by `llm_confidence`: low .4, mid .7, high 1, super_high 1.2 |
| `direction` | from the derived score: `> .15` support, `< −.15` oppose, else neutral |
| `n` | number of statements (shown as ×N) |
| `first`, `last` | date range |
| `flip` | true when the set of non-neutral statement directions has more than one member (neutral → support is **not** a flip) |
| `linkage`, `llm_confidence` | the maximum across statements |
| `quote`, `bill`, `source` | from the latest statement (used as the headline evidence) |
| `salience` | Σ over statements of `venue_weight × 2^(−age_days / 180)`; `venue_weight` = 1.0 for `media_type: gov`, 0.8 for major news, 0.6 otherwise; `age_days` relative to today (mock data: relative to the newest statement so the demo is stable) |
| `heat` | percentile rank of `salience` across all edges, 0…1 |

## Per-legislator

| derived field | rule |
|---|---|
| decisiveness | mean of |edge score| across the legislator's issues |
| vs own party | mean over issues of |score − mean score of other same-party members on that issue|, over issues where such a mean exists |
| flipped | count of edges with `flip` |

## Views

- **Explore**: nodes = issues (colour by committee) + legislators (colour by party); edge width = `1 + 5·heat`, opacity = `.45 + .45·|score|`, dashed when `flip`. Filters: issues (multi), state, party, direction, min confidence, text search.
- **Issues (focus)**: one issue, its legislators on a −1…+1 spectrum, grey ring = other issues those legislators also have edges on.
- **Find (list)**: dropdown filters → one row per edge, sortable, CSV export.
- **Legislators (profile)**: hero + stat strip, AI summary with citations, Overview (attention map x=score y=salience, fingerprint radar), Issues by committee (diverging bars, party-average tick, attention dot, ribbon), Timeline (all statements across issues on one time axis). Deep link `#/legislator/<id>`.

## Non-goals

The frontend never calls a model, never rewrites a quote, never hides a flip, and never merges two issues. If a derived rule needs a new input, that is a contract-B change (issue label `contract`).
