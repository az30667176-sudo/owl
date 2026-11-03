#!/usr/bin/env bash
# Start Muse Code in the OWL repo with the hackathon Model API key, so the session bills the
# Meta credit (pay-as-you-go) and not a personal login or subscription.
#
#   tools/muse-owl.sh                               # interactive TUI in the repo root
#   tools/muse-owl.sh "fix the failing validator"   # start with a prompt
#   tools/muse-owl.sh exec --json "..."             # headless / CI
#   tools/muse-owl.sh --model muse-spark-1.3 ...    # standard tier for this run (default: muse-spark-1.3-contributor, team decision Oct 30;
#                                                   # override with MUSE_MODEL=... or --model)
#
# Key lookup order: META_API_KEY already exported > MODEL_API_KEY already exported >
# MODEL_API_KEY in $OWL_ENV_FILE (default <repo>/.env, the file .env.example describes;
# quoted or unquoted, with or without "export").
# Repo root: $OWL_REPO, else the parent of this script's directory (tools/..).
set -euo pipefail
root="${OWL_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
envfile="${OWL_ENV_FILE:-$root/.env}"
key="${META_API_KEY:-${MODEL_API_KEY:-}}"
if [ -z "$key" ] && [ -f "$envfile" ]; then
  key="$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?MODEL_API_KEY[[:space:]]*=[[:space:]]*['\"]?([^'\"[:space:]]+)['\"]?.*/\2/p" "$envfile" | head -1)"
fi
[ -n "$key" ] || { echo "muse-owl: no key. Put MODEL_API_KEY in $envfile (see .env.example) or export META_API_KEY." >&2; exit 1; }
command -v muse >/dev/null 2>&1 || { echo "muse-owl: muse not installed. Run: curl -fsSL https://dev.meta.ai/install.sh | sh" >&2; exit 1; }
export META_API_KEY="$key"   # Muse Code checks META_API_KEY before any stored key or browser login
cd "$root"
case " $* " in
  *" --model "*) exec muse "$@" ;;
  *) exec muse --model "${MUSE_MODEL:-muse-spark-1.3-contributor}" "$@" ;;
esac
