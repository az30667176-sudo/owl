# Launch Claude Code on Meta's Model API (Muse) so the session bills to the Meta credit, not Anthropic.
# Reads MODEL_API_KEY from <repo>/.env. Usage:  powershell -File tools/claude-muse.ps1 [-Model muse-wonder-1.0]
# Docs: https://dev.meta.ai/docs/coding-agents
param([string]$Model = "muse-spark-1.3")

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { Write-Error ".env not found at $envFile (copy .env.example and add MODEL_API_KEY)"; exit 1 }
$key = (Get-Content $envFile | Where-Object { $_ -match '^\s*MODEL_API_KEY\s*=' } | Select-Object -First 1) -replace '^\s*MODEL_API_KEY\s*=\s*', '' -replace '^["'']|["'']$', ''
if (-not $key) { Write-Error "MODEL_API_KEY is empty in .env"; exit 1 }

$env:ANTHROPIC_BASE_URL = "https://api.meta.ai"      # no /v1; Claude Code appends /v1/messages
$env:ANTHROPIC_AUTH_TOKEN = $key                      # bearer auth (not ANTHROPIC_API_KEY)
$env:ANTHROPIC_MODEL = $Model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $Model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = "muse-spark-1.3"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "muse-spark-1.3"
$env:CLAUDE_CODE_SUBAGENT_MODEL = "muse-spark-1.3"
$env:ENABLE_TOOL_SEARCH = "true"

Write-Host "Claude Code -> Meta Model API, model=$Model (subagents: muse-spark-1.3)"
Set-Location $root
claude
