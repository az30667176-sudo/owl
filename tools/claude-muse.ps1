# Launch Claude Code on Meta's Model API (Muse) so the session bills to the Meta credit, not Anthropic.
# Reads MODEL_API_KEY from <repo>/.env.
# Interactive:      powershell -File tools/claude-muse.ps1 [-Model muse-wonder-1.0]
# One-shot (CI/agent): powershell -File tools/claude-muse.ps1 -p "fix the failing test"
#                      Get-Content task.md -Raw | powershell -File tools/claude-muse.ps1 -p --allowedTools "Read,Edit,Bash(git *)"
# Docs: https://dev.meta.ai/docs/coding-agents
param([string]$Model = "muse-spark-1.3")
# Any other arguments are passed straight to claude (e.g. -p, --allowedTools). Pipe stdin for a long prompt.

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { Write-Error ".env not found at $envFile (copy .env.example and add MODEL_API_KEY)"; exit 1 }
$key = (Get-Content $envFile | Where-Object { $_ -match '^\s*MODEL_API_KEY\s*=' } | Select-Object -First 1) -replace '^\s*MODEL_API_KEY\s*=\s*', '' -replace '^["'']|["'']$', ''
if (-not $key) { Write-Error "MODEL_API_KEY is empty in .env"; exit 1 }

# Drop anything inherited from a parent Claude Code session (desktop app / nested shells) so the
# claude.ai login does not shadow the Meta key.
Get-ChildItem Env: | Where-Object { $_.Name -like "CLAUDE_CODE_*" -or $_.Name -like "ANTHROPIC_*" } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }

$env:ANTHROPIC_BASE_URL = "https://api.meta.ai"      # no /v1; Claude Code appends /v1/messages
$env:ANTHROPIC_AUTH_TOKEN = $key                      # bearer auth (not ANTHROPIC_API_KEY)
$env:ANTHROPIC_MODEL = $Model
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = $Model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = "muse-spark-1.3"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "muse-spark-1.3"
$env:CLAUDE_CODE_SUBAGENT_MODEL = "muse-spark-1.3"
$env:ENABLE_TOOL_SEARCH = "true"
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
$env:CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = "1"

Write-Host "Claude Code -> Meta Model API, model=$Model (subagents: muse-spark-1.3)"
Set-Location $root
& claude @args
