# Agent Session Router — Setup & Integration

## Prerequisites

- **VS Code** 1.90 or later
- **Node.js** 20 or later
- **Git** (for cloning / updates)
- [Agent Sessions](https://github.com/avidullu/agent-sessions) repo (optional but recommended)

## Installation

### Option 1: Agentic Install (Recommended 🤖)

Run the automated setup script — it handles everything:

```bash
# macOS / Linux / WSL
./scripts/agentic-install.sh --auto-watch
```

```powershell
# Windows
.\scripts\agentic-install.ps1 -AutoWatch
```

The script compiles, tests (93 tests), packages, installs, and prints your next steps.

### Option 2: From VSIX (Pre-built)

1. Download the latest `.vsix` from [Releases](https://github.com/avidullu/agent-session-router/releases)
2. Install:
   ```bash
   code --install-extension agent-session-router-0.1.0.vsix --force
   ```

### Option 3: From Source (Development)

```bash
git clone https://github.com/avidullu/agent-session-router.git
cd agent-session-router
npm ci
npm run compile
npm test                        # verify: 93 tests pass
npx @vscode/vsce package -o agent-session-router.vsix
code --install-extension agent-session-router.vsix --force
```

Press `F5` in VS Code to launch the Extension Development Host instead of installing.

## Post-Install

### 1. Reload VS Code
`Ctrl+Shift+P` → **Developer: Reload Window**

### 2. Set Output Directory
`Ctrl+Shift+P` → **Agent Session Router: Set Output Directory**

Choose your Agent Sessions `archive/` directory (or any folder where you want
Markdown files saved). The extension auto-detects `~/Projects/Agent Sessions/archive/`.

### 3. Export Your Sessions
`Ctrl+Shift+P` → **Agent Session Router: Export All Sessions**

Your past AI coding sessions will be exported as Markdown files.

### 4. (Optional) Enable Auto-Watch
`Ctrl+Shift+P` → **Agent Session Router: Auto-Export — Monitor for New Sessions**

New sessions will be automatically exported as they complete.

## Integration with Agent Sessions

If you use the [Agent Sessions](https://github.com/avidullu/agent-sessions) hub:

1. The extension writes Markdown to `archive/{source}/` + an `archive/.router-index.jsonl` sidecar
2. The hub'\''s `export` command merges the sidecar into `archive/index.jsonl`
3. Run in the Agent Sessions repo:
   ```bash
   python tools/agent_archive.py export --all
   ```

The extension and hub share a **contract** (`docs/OUTPUT_CONTRACT.md`) ensuring
the Markdown format is always compatible.

## Daily Workflow

### Option A: Manual Export
Run **Export All Sessions** whenever you want to archive recent sessions.

### Option B: Auto-Watch (Set and Forget)
Enable the watcher once — every new session is exported within seconds of
completion. No manual steps needed.

### Option C: Cron / Scheduled Task
Add `code --command agentSessionRouter.exportAll` to a daily cron job or
Windows Task Scheduler entry.

## Updating

```bash
cd agent-session-router
git pull origin master
npm ci
npm run compile
npm test
npx @vscode/vsce package -o agent-session-router.vsix
code --install-extension agent-session-router.vsix --force
```

Or re-run the agentic install script (idempotent).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "No agent sessions found" | Run **Discover Sessions** first to verify sources are reachable |
| Exported Markdown is empty | Check Output Channel for `[extract]` errors; run **Export Diagnostic Bundle** |
| Watcher not starting | Ensure `agentSessionRouter.watch.enabled: true`; check Output Channel |
| "chokidar not installed" warning | Run `npm install chokidar` for better watcher performance |
| Extension not loading | VS Code ≥ 1.90 required; check `Help → Toggle Developer Tools → Console` |

## Uninstall

```bash
code --uninstall-extension avidullu.agent-session-router
```

Your exported Markdown files and settings are not removed.