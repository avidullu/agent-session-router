#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Agent Session Router — Agentic Installation
# ─────────────────────────────────────────────────────────────────────
# Run this script to install the extension with all best practices.
# An AI agent can follow this to set up a user's environment optimally.
#
# Usage:
#   chmod +x scripts/agentic-install.sh
#   ./scripts/agentic-install.sh [--dev] [--output-dir PATH]
#
# Options:
#   --dev           Install from source (F5 dev host) instead of .vsix
#   --output-dir    Set the Agent Sessions archive/ directory
#   --auto-watch    Enable auto-export watcher after install
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

# ── Parse flags ────────────────────────────────────────────────────
DEV_MODE=false
AUTO_WATCH=false
OUTPUT_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dev)          DEV_MODE=true; shift ;;
        --auto-watch)   AUTO_WATCH=true; shift ;;
        --output-dir)   OUTPUT_DIR="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 [--dev] [--output-dir PATH] [--auto-watch]"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# ── Prerequisites ──────────────────────────────────────────────────
echo "==> Checking prerequisites..."

command -v node >/dev/null 2>&1 || { echo "ERROR: Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: npm is required."; exit 1; }

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "WARNING: Node.js 20+ recommended (found v$(node -v)). Some features may not work."
fi

# ── Install dependencies ───────────────────────────────────────────
echo "==> Installing dependencies..."
npm ci --production=false

# ── Compile ────────────────────────────────────────────────────────
echo "==> Compiling TypeScript..."
npm run compile

# ── Run tests ──────────────────────────────────────────────────────
echo "==> Running test suite (93 tests)..."
npm test
echo "   All tests passed."

# ── Package ────────────────────────────────────────────────────────
if [ "$DEV_MODE" = false ]; then
    echo "==> Packaging extension..."
    npx --yes @vscode/vsce package --allow-missing-repository -o agent-session-router.vsix

    echo "==> Installing extension..."
    code --install-extension agent-session-router.vsix --force
    echo "   Extension installed."
else
    echo "==> Dev mode: Open this folder in VS Code and press F5 to launch."
    echo "   Or run: code . && (press F5)"
fi

# ── Configure ──────────────────────────────────────────────────────
echo ""
echo "==> Recommended VS Code settings (add to settings.json):"
echo ""

if [ -n "$OUTPUT_DIR" ]; then
    echo "  \"agentSessionRouter.outputDir\": \"$OUTPUT_DIR\""
else
    DEFAULT_DIR="$HOME/Projects/Agent Sessions/archive"
    echo "  // Set your Agent Sessions archive directory:"
    echo "  \"agentSessionRouter.outputDir\": \"$DEFAULT_DIR\""
fi

echo "  \"agentSessionRouter.watch.enabled\": $AUTO_WATCH"
echo "  \"agentSessionRouter.maxSessionAge\": \"90d\""
echo ""

# ── Next steps ────────────────────────────────────────────────────
echo "==> Setup complete!"
echo ""
echo "   Next steps for the user:"
echo "   1. Reload VS Code: Ctrl+Shift+P → 'Developer: Reload Window'"
echo "   2. Run: Ctrl+Shift+P → 'Agent Session Router: Set Output Directory'"
echo "   3. Run: Ctrl+Shift+P → 'Agent Session Router: Export All Sessions'"
echo "   4. (Optional) Start auto-watch: 'Agent Session Router: Auto-Export — Monitor'"
echo ""
echo "   For the Agent Sessions archive pipeline:"
echo "   cd ~/Projects/Agent\\ Sessions && python tools/agent_archive.py export --all"
