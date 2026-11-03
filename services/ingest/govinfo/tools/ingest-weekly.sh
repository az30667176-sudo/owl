#!/usr/bin/env bash
# Weekly OWL ingest, two ways:
#
#   tools/ingest-weekly.sh                 # through Muse Code (headless): the agent runs `ingest.py run`, reads RESULT, writes state/last_report.md
#   tools/ingest-weekly.sh --direct        # no agent: just `python3 -I ingest.py run` (same data; for cron/CI without a key, or when muse is missing)
#   tools/ingest-weekly.sh --publish DIR   # where the CSV drop goes (default: <repo>/data/ingest when this directory sits inside the OWL repo)
#   tools/ingest-weekly.sh --no-publish    # keep the drop in out_full/csv only
#
# Environment: META_API_KEY (agent mode; also read from MODEL_API_KEY in a nearby .env), MUSE_MODEL (default
# muse-spark-1.3-contributor, the team's tier), MUSE_EXTRA_FLAGS (e.g. --disable-sandbox on a CI runner).
# Scheduled by .github/workflows/ingest-weekly.yml (Monday cron); idempotent: nothing new on govinfo -> no rebuild, exit 0.
# Lives at services/ingest/govinfo/tools/ in the repo (services/ingest/ itself is Ben's csv-to-json.mjs, the consumer).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"
direct=0; publish=""; nopublish=0
while [ $# -gt 0 ]; do
  case "$1" in
    --direct) direct=1 ;;
    --publish) publish="$2"; shift ;;
    --no-publish) nopublish=1 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
# The OWL repo: OWL_REPO, or the nearest ancestor holding packages/contract/validate.mjs (services/ingest/govinfo -> repo root).
repo="${OWL_REPO:-}"
if [ -z "$repo" ]; then
  d="$here"
  while [ "$d" != "/" ]; do
    if [ -f "$d/packages/contract/validate.mjs" ]; then repo="$d"; break; fi
    d="$(dirname "$d")"
  done
fi
if [ -z "$publish" ] && [ "$nopublish" = 0 ] && [ -n "$repo" ]; then
  publish="$repo/data/ingest"
fi
pub_arg=(); [ -n "$publish" ] && pub_arg=(--publish "$publish")

if [ "$direct" = 1 ] || ! command -v muse >/dev/null 2>&1; then
  [ "$direct" = 1 ] || echo "muse not installed; running the pipeline directly" >&2
  exec python3 -I ingest.py run "${pub_arg[@]}"
fi

# Key: Muse Code reads META_API_KEY. Team conventions: MUSE_API_KEY (services/process) or MODEL_API_KEY in <repo>/.env
# (never printed, never committed); either is bridged here.
if [ -z "${META_API_KEY:-}" ] && [ -n "${MUSE_API_KEY:-}" ]; then export META_API_KEY="$MUSE_API_KEY"; fi
if [ -z "${META_API_KEY:-}" ] && [ -n "${MODEL_API_KEY:-}" ]; then export META_API_KEY="$MODEL_API_KEY"; fi
if [ -z "${META_API_KEY:-}" ]; then
  for f in "${OWL_ENV_FILE:-}" "${repo:+$repo/.env}" "$here/../.env" "$here/.env"; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    k="$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?(MUSE|MODEL)_API_KEY[[:space:]]*=[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?.*/\3/p" "$f" | head -1)"
    if [ -n "$k" ]; then export META_API_KEY="$k"; break; fi
  done
fi
if [ -z "${META_API_KEY:-}" ] && ! muse usage >/dev/null 2>&1; then
  echo "no META_API_KEY and no stored muse login; running the pipeline directly" >&2
  exec python3 -I ingest.py run "${pub_arg[@]}"
fi

# The skill lives in skills/ (tracked). Muse Code scans .agents/skills/, which the repo's .gitignore ignores by design,
# so sync it there at run time (a copy, never committed).
rm -rf "$here/.agents/skills/ingest-weekly"
mkdir -p "$here/.agents/skills"
cp -R "$here/skills/ingest-weekly" "$here/.agents/skills/ingest-weekly"

prompt="Run the weekly OWL ingest in this directory exactly as the ingest-weekly skill and AGENTS.md describe: execute
\`python3 -I ingest.py run ${pub_arg[*]}\` once, wait for it to finish (it can take 15 minutes), read its final RESULT line,
then write a short plain-text report to state/last_report.md: whether anything was new, the new reports (id, date,
committee, bill, title), rows added per table from build.added, validator result, and the log path. Do not run
pipeline steps by hand, do not edit code, do not commit."
# shellcheck disable=SC2086
exec muse exec --workspace "$here" --trust-workspace --approval-mode never --disable-web-tools \
  --model "${MUSE_MODEL:-muse-spark-1.3-contributor}" --reasoning-effort low --max-model-steps 25 \
  ${MUSE_EXTRA_FLAGS:-} "$prompt"
