# OWL — rules for coding agents (Muse Code, Claude Code, Codex)

Project: OWL — Open Watch on Legislators. Evidence-anchored knowledge graph of U.S. House members'
stances on issues, built for the Meta AI Developer Hackathon (submission 2026-11-04, 9 pm ET).
Read before changing anything: `packages/contract/README.md` (contracts A/B/C, the single source of truth),
`packages/contract/derived.md`, `data/README.md`, `docs/WORKFLOW.md`, `openspec/config.yaml`.

## Hard rules (mirror of openspec/config.yaml)
- Quotes are verbatim substrings of the source record; never paraphrased.
- Statements are never pre-aggregated; one row per statement. Direction derives from score (> .15 support, < -.15 oppose).
- English only. U.S. House members only; no senators.
- A schema change needs a GitHub issue labelled `contract` and the consuming side's OK.
- After any change under `data/` or `packages/contract/`, run
  `node packages/contract/validate.mjs data --records data/records` (CI adds `--strict` for real data).

## Workflow
- Anything beyond a one-line fix starts as an OpenSpec change: "openspec propose <what>", review it,
  "openspec apply", and after merge "openspec archive". Proposals stay under 400 words and name the
  contract touched (A, B, C or none) and the GitHub issue.
- Branch per issue: `feat/<issue>-<slug>` or `fix/<issue>-<slug>`. PR bodies say `Closes #N`.
- Do not push, open pull requests, or rewrite published history unless the user asks in the session.
- Never stage `.env`, `cache/`, `node_modules/`, `data/raw/` or large scratch output (see `.gitignore`).

## Decisions in force (Oct 30, 2026)
- Muse Code sessions use `muse-spark-1.3-contributor` (`tools/muse-owl.sh` sets it; `--model` overrides).
- The ingest CSV drop lives in `data/ingest/` (written only by `services/ingest/govinfo/ingest.py build --publish`);
  `services/ingest/csv-to-json.mjs` (Ben) turns it into contract JSON and is the build's validation gate.
- The weekly ingest runs on the GitHub Actions cron `.github/workflows/ingest-weekly.yml`, operated by Muse Code
  on the runner; its pull requests are titled `data: weekly ingest drop <date>`.

## Commits
- Run `git commit` yourself through the shell tool (not a built-in git or commit helper), so the
  repository's configured `user.name` and `user.email` are the author and committer.
- Message: one imperative English subject line, prefixed by area (`ingest:`, `process:`, `web:`,
  `contract:`, `openspec:`, `docs:`), a blank line, an optional short body, then one trailer line per
  tool that wrote the code:
  - `Co-Authored-By: Muse Code <noreply@meta.com>` — Muse Code, or Claude Code pointed at the Meta Model API
  - `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` — Claude Code on Anthropic
