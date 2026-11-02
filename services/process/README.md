# services/process

Model stage: contract-A records → contract-B statements/summaries (Muse Spark
via the Meta Model API, OpenAI-compatible). Auth: `MUSE_API_KEY` (fallback
`MODEL_API_KEY`), optionally from the repo-root `.env` (gitignored).

## extract.mjs — one record, interactive use

```bash
node services/process/extract.mjs <record.json> [--merge] [--model muse-spark-1.3]
```

Writes `data/extracted/<id>.extracted.json`; `--merge` appends accepted
statements to `stances.json` (and new issues to `issues.json`).

## extract-batch.mjs — backfill driver

```bash
# trial 5 views records, no merge, report tokens
node services/process/extract-batch.mjs data --limit 5
# full views backfill with merge (excludes rec-billstatus-* by default)
node services/process/extract-batch.mjs data --merge --supersede-signatures
```

Options: `--records <dir>` (default `<data>/records`), `--limit N`
(longest-first trial), `--max-input-tokens N` (budget stop),
`--concurrency N` (default 3), `--include/--exclude <substr>` record filter,
`--sort longest|id`, `--dry-run` (prompt-size estimates, no API calls),
`--redo` (ignore resume state), `--merge`, `--merge-new-issues`,
`--supersede-signatures`, `--model`, `--base-url`, `--max-tokens` (default
16000; Muse Spark is a reasoning model, so headroom matters),
`--reasoning-effort low|medium|high` (default low).

Behavior:

- Slim prompts: only the record's hinted persons + the issue/subcommittee
  lists (not all 451 legislators), retries with backoff on 429/5xx.
- Hard validation per statement (unknown person/issue, non-verbatim quote,
  speaker-tag quote, bad enums); direction is derived from score.
  `person` must be a signer of the record (stricter than `extract.mjs`).
- Resume by default via `data/extracted/*.extracted.json`.
- `new_issue` proposals are staged in `extracted/_new-issues.json` for human
  review; statements on staged issues are held unless `--merge-new-issues`.
- `--supersede-signatures` drops deterministic "Signed … views" rows for a
  (person, record, issue) once the model covers that triple with real speech
  quotes (same-issue only, so no signal is lost).
- `--only id[,id…]` targets specific records (retries, model comparisons).
- `--merge-only` merges already-extracted files with zero API calls.
  Idempotent (skips already-merged facts), so re-run it after human review;
  combine with `--merge-new-issues` to also land staged issues and the
  statements held on them.
- Every call's token usage is logged; totals print at the end.

## extract-conditions.mjs — conditions ledger

```bash
node services/process/extract-conditions.mjs data --model muse-spark-1.3-contributor --merge
```

Same batch machinery as `extract-batch.mjs` (resume via
`data/extracted/cond-*.extracted.json`, retries, budget caps, `--limit`,
`--concurrency`, `--only`, `--dry-run`), but extracts conditional stances
("would support if X") into `data/conditions.json`, consolidating demand
proposals into the demands registry deterministically (same-type similar
names merge; shortest wins; ids are slugs). Only records matching a
conditional-language prefilter are sent (`--no-prefilter` disables it).
`statement_id` links on exact quote match, else null (allowed).

## summarize.mjs — per-legislator summaries

```bash
node services/process/summarize.mjs [--only p09,p04] [--model muse-spark-1.3] [--dry] [--concurrency N] [--redo]
```

Writes `data/summaries.json` (merging with existing entries): 2–4 neutral
cited sentences per legislator. Run after stances are final.

See docs/ARCHITECTURE.md for the contract this service consumes/produces.
