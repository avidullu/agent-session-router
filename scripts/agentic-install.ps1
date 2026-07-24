# Agentic Installation — PowerShell (Windows)
# ─────────────────────────────────────────────────────────────────────
# Run this script to install the extension with all best practices.
# An AI agent can follow this to set up a user's environment optimally.
#
# Usage:
#   .\scripts\agentic-install.ps1 [-Dev] [-OutputDir PATH] [-AutoWatch]
#
# Options:
#   -Dev           Install from source (F5 dev host) instead of .vsix
#   -OutputDir     Set the Agent Sessions archive/ directory
#   -AutoWatch     Enable auto-export watcher after install
# ─────────────────────────────────────────────────────────────────────

param(
    [switch]$Dev,
    [string]$OutputDir = "",
    [switch]$AutoWatch
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

# ── Prerequisites ──────────────────────────────────────────────────
Write-Host "==> Checking prerequisites..." -ForegroundColor Cyan

$nodeVersion = (node -v 2>$null) -replace 'v',''
if (-not $nodeVersion) {
    Write-Host "ERROR: Node.js is required. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}
$majorVersion = [int]($nodeVersion -split '\.')[0]
if ($majorVersion -lt 20) {
    Write-Host "WARNING: Node.js 20+ recommended (found v$nodeVersion)." -ForegroundColor Yellow
}

# ── Install dependencies ───────────────────────────────────────────
Write-Host "==> Installing dependencies..." -ForegroundColor Cyan
npm ci --production=false
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

# ── Compile ────────────────────────────────────────────────────────
Write-Host "==> Compiling TypeScript..." -ForegroundColor Cyan
npm run compile
if ($LASTEXITCODE -ne 0) { throw "Compile failed" }

# ── Run tests ──────────────────────────────────────────────────────
Write-Host "==> Running test suite (93 tests)..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "Tests failed" }
Write-Host "   All 93 tests passed." -ForegroundColor Green

# ── Package & Install ──────────────────────────────────────────────
if (-not $Dev) {
    Write-Host "==> Packaging extension..." -ForegroundColor Cyan
    npx --yes @vscode/vsce package --allow-missing-repository -o agent-session-router.vsix
    if ($LASTEXITCODE -ne 0) { throw "Package failed" }

    Write-Host "==> Installing extension..." -ForegroundColor Cyan
    code --install-extension agent-session-router.vsix --force
    if ($LASTEXITCODE -ne 0) { throw "Install failed" }
    Write-Host "   Extension installed." -ForegroundColor Green
}
else {
    Write-Host "==> Dev mode: Open this folder in VS Code and press F5." -ForegroundColor Yellow
}

# ── Configure ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "==> Recommended VS Code settings (add to settings.json):" -ForegroundColor Cyan
Write-Host ""

if ($OutputDir) {
    Write-Host '  "agentSessionRouter.outputDir": "' -NoNewline
    Write-Host $OutputDir -NoNewline -ForegroundColor Yellow
    Write-Host '"'
}
else {
    $defaultDir = "$env:USERPROFILE\Projects\Agent Sessions\archive"
    Write-Host "  // Set your Agent Sessions archive directory:"
    Write-Host '  "agentSessionRouter.outputDir": "' -NoNewline
    Write-Host $defaultDir -NoNewline -ForegroundColor Yellow
    Write-Host '"'
}

$watchValue = if ($AutoWatch) { "true" } else { "false" }
Write-Host "  `"agentSessionRouter.watch.enabled`": $watchValue"
Write-Host '  "agentSessionRouter.maxSessionAge": "90d"'
Write-Host ""

# ── Next steps ────────────────────────────────────────────────────
Write-Host "==> Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "   Next steps for the user:"
Write-Host "   1. Reload VS Code: Ctrl+Shift+P -> 'Developer: Reload Window'"
Write-Host "   2. Run: Ctrl+Shift+P -> 'Agent Session Router: Set Output Directory'"
Write-Host "   3. Run: Ctrl+Shift+P -> 'Agent Session Router: Export All Sessions'"
Write-Host "   4. (Optional) Start auto-watch: Ctrl+Shift+P -> 'Auto-Export — Monitor'"
Write-Host ""
Write-Host "   For the Agent Sessions archive pipeline:"
Write-Host "   cd ~\Projects\Agent Sessions; python tools\agent_archive.py export --all"
