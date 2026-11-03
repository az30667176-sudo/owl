# Web

## Prototype

`index.html` is the zero-build app (category -> sub-category -> legislators -> evidence), rendering `mock-data.js` shaped like `packages/contract/vis.schema.json` plus a taxonomy layer.

Run: `python -m http.server 8090 (from the repo root) then open http://localhost:8090/apps/web/` then open http://localhost:8090

Legislator names in the mock are fictional. The production app (Next.js) will replace this once contract C is frozen.
Conditions: when `data/conditions.json` is present, Explore shows ◆ markers with what-if tooltips plus a bill-grouped demand panel, and profiles gain a Conditions block; when absent, the app looks and behaves exactly as before.
Explore renders on Canvas (committee ring with open-in-place, global `/` search, fly-to, linked district minimap); see `openspec/changes/explore-redesign/`.
Issues is a directory (committee columns with support/neutral/oppose bars and member counts) plus one halo page per issue (`#/issue/<id>`: action half-rings with party-coloured dots, right = for / left = against, party splits, strongest voices, stance-coloured district tile map, bills under the issue, related-issue chips). Bills lists every bill found in statements and conditions, most statements first, filterable by number or title; rows open `#/bill/<id>`.

## Blind scoring audit

`data/audit/blind-scoring.json` re-scores sampled speech quotes with the speaker's
name and party hidden, using the same scoring convention as production, and compares
blind vs published scores. Reproduce with:

```bash
node services/process/audit/blind-scoring.mjs data --n 100 --seed 30
```

Latest run (muse-spark-1.3, 2026-11-03, n=101: D uniform sample of 100 + the only
R speech row in the corpus):

| metric | value |
|---|---|
| mean \|blind − published\| | 0.41 (signed +0.24) |
| direction agreement | 71% |
| published support reproduced (65/70) | 93% |
| published oppose reproduced (7/31) | 23% |

Almost all disagreement is one-sided: 24 of 31 published-oppose quotes flip to
neutral/support under blinding. Inspection shows why — the original prompt never
pinned whether a score is toward the issue or toward the bill, so bare
bill-opposition ("I oppose this legislation") was scored as issue-opposition,
while structurally identical quotes elsewhere were scored toward the issue
(st24908 "+0.9" vs st27304 "−0.9" for the same "bill harms X" shape). The blind
prompt pins the toward-issue convention, and the production rubric
(`services/process/scoring.mjs`) now carries the same rule. Re-running this audit
after a re-score will measure stability rather than convention noise.

Party-bias comparison is not yet possible: the speech corpus holds 3,268 D rows
and 1 R row (process has only covered minority/dissenting views so far), so there
is no Republican sample to compare against. The single R row agreed exactly
(−0.9 → −0.9). Process more majority-party records, then re-run with `--party`.
