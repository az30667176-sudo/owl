#!/usr/bin/env bash
# CI step: if the weekly ingest changed the CSV drop (data/ingest) or the ingest state, commit on a dated branch, push,
# and open a pull request. Run from the repo root with GH_TOKEN set. DRY_RUN=1 commits locally but neither pushes nor
# opens the PR (used by the local test). Never commits cache/, out_full/ or logs.
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
ingest="${INGEST_DIR:-services/ingest/govinfo}"        # where the govinfo pipeline lives in the repo
paths=(data/ingest "$ingest/state/packages.json" "$ingest/state/handoff_keys.json")
existing=(); for p in "${paths[@]}"; do [ -e "$p" ] && existing+=("$p"); done
[ ${#existing[@]} -gt 0 ] || { echo "nothing to publish (no data/ingest yet)"; exit 0; }
git add -A -- "${existing[@]}"
if git diff --cached --quiet; then echo "drop unchanged: nothing to commit"; exit 0; fi
date="$(date -u +%F)"; branch="data/ingest-${date}"
if [ "${DRY_RUN:-0}" != 1 ] && git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  branch="${branch}-${GITHUB_RUN_ID:-$(date -u +%H%M)}"      # a second run on the same day gets its own branch
fi
git config user.name "${GIT_AUTHOR_NAME:-github-actions[bot]}"
git config user.email "${GIT_AUTHOR_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
git checkout -B "$branch"
{
  echo "data: weekly ingest drop ${date}"
  echo
  echo "Automated weekly run of $ingest (House committee reports from govinfo, no model)."
  echo "Rows added per table and newly parsed reports: see data/ingest/CHANGES.md; added rows only: data/ingest/delta/."
  echo "The drop was converted with services/ingest/csv-to-json.mjs and passed packages/contract/validate.mjs before publishing."
  if [ -f "$ingest/state/last_report.md" ]; then
    echo; echo "Agent report:"; echo; sed 's/^/    /' "$ingest/state/last_report.md"
  fi
} | git commit -q -F -
echo "committed on $branch: $(git log --oneline -1)"
if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY_RUN: not pushing, not opening a PR"; exit 0; fi
git push -u origin "$branch"
body="$(mktemp)"
{
  cat data/ingest/CHANGES.md
  echo
  echo "## Next (services/process)"
  echo
  echo "The drop passed \`services/ingest/csv-to-json.mjs\` + \`packages/contract/validate.mjs\` on the runner. To refresh the JSON:"
  echo
  echo '```'
  echo "node services/ingest/csv-to-json.mjs data/ingest data --sub-names data/taxonomy.json --drop ingest-${date}"
  echo "node services/process/extract-batch.mjs data --merge-only --supersede-signatures   # re-merge extracted statements, no API calls"
  echo "node services/process/extract-batch.mjs data --merge --supersede-signatures        # new records only (resume), then summarize.mjs"
  echo '```'
  echo
  echo "Note: csv-to-json.mjs rewrites issues.json (the seed issues only) and stances.json (deterministic rows only) from the CSV; the merge steps put the model-extracted statements back. Check that the reviewed issues (187 on Nov 2) survive, or re-run review-issues.mjs."
  echo "If bills.json exists: the process-merged fields short_context / binary_question (#32) must be carried forward by bill_id; check they survive the regen."
} > "$body"
if gh pr create --base main --head "$branch" --title "data: weekly ingest drop ${date}" --body-file "$body" --label area:ingest 2>pr.err; then
  echo "pull request opened"
else
  cat pr.err >&2
  echo "::warning::Could not open the pull request (check the repo setting 'Allow GitHub Actions to create and approve pull requests'). The branch is pushed: ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/compare/${branch}?expand=1"
fi
