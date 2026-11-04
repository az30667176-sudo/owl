# Contract C — what the frontend derives from contract B

These rules live in `apps/web/prototype/index.html` (and will move to the production app unchanged). They are documented here so the process team knows what the UI will do with their rows, and so nobody pre-computes them upstream.

## Edge = one (person, issue) pair

For all statements with the same `person` and `issue`, sorted by `date`:

| derived field | rule |
|---|---|
| `score` | weighted mean of *effective* statement scores (`score` × kind factor, see below) over stance rows only — speech, sponsorships, final-passage and unknown-question votes — weights by `llm_confidence` (low .4, mid .7, high 1, super_high 1.2) × time decay (newest statement in the set 1.0, oldest 0.2, exponential between; dateless rows count as oldest). Amendment/procedural votes count toward `n`/salience only; an edge with no stance rows scores 0 (neutral) |
| `direction` | from the derived score: `> .15` support, `< −.15` oppose, else neutral |
| `n` | number of statements (shown as ×N) |
| `first`, `last` | date range |
| `flip` | true when the non-neutral directions among speech and final-passage-vote statements have more than one member (neutral → support is **not** a flip; amendment/procedural yea+nay pairs are **not** flips; votes without a known question count as before) |
| `linkage`, `llm_confidence` | the maximum across statements |
| `quote`, `bill`, `source` | from the latest statement (used as the headline evidence) |
| `salience` | Σ over statements of `2^(−age_days / 180)` (recent statements count more, half-life 180 days); `age_days` relative to today (mock data: relative to the newest statement so the demo is stable). All sources are official records, so there is no venue weighting |
| `heat` | percentile rank of `salience` across all edges, 0…1 |

## Statement kinds (Contract B `kind` / `vote_question`)

Every statement row carries a `kind`: `speech` (a scored utterance), `sponsored` /
`cosponsored` (a signature, not words spoken), `vote` (a cast vote), or `views`
(legacy views-signature rows; no longer emitted). Vote rows further carry
`vote_question` (`final_passage` | `amendment` | `procedural`) when the question
could be recognised from the record; the field is omitted rather than guessed.

Kind factors, applied to every statement score before aggregation (stored scores
are untouched; this is display math). A cosponsorship (`+0.8`) thus contributes
`+0.4`, while speech counts in full:

| kind | factor |
|---|---|
| speech | 1.0 |
| sponsored | 0.8 |
| cosponsored | 0.5 |
| vote, final_passage | 1.0 |
| vote, amendment / procedural | 0.5 |
| vote, question unknown | 0.75 |
| views (legacy rows) | 0.25 |

Rows without `kind` (mock/legacy data) resolve through the old
model/rationale inference and take the same factors. Rows are already deduped
upstream (one action → one row on the bill's primary issue), so no
consumer-side dedupe is needed.

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
