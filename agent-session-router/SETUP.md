# Setup & Integration Guide

How the Agent Session Router VS Code extension works with the
[Agent Sessions](https://github.com/avidullu/agent-sessions) Python archive tool.

## Architecture

```
┌─────────────────────────┐          ┌──────────────────────────┐
│  agent-session-router    │  writes  │  Agent Sessions repo      │
│  (VS Code extension)     │─────────→│  (Python CLI tool)        │
│                          │          │                          │
│  Discover → Extract →    │  .md +   │  export → index → status  │
│  Render → Write          │  .router-│  → baseline → replay     │
│                          │  index   │                          │
└─────────────────────────┘          └──────────────────────────┘
         archive/                        archive/
         ├── copilot-vscode/             ├── index.jsonl
         │   └── {session}.md            ├── INDEX.md
         ├── deepseek-vscode/            └── .router-index.jsonl
         │   └── {session}.md
         └── .router-index.jsonl
```

The two tools communicate **purely through the filesystem**. The `archive/`
directory is the contract. No shared database, no API, no dependency between
them.

## Prerequisites

- VS Code with one or more AI extensions (Copilot Chat, DeepSeek V4, etc.)
- [Agent Sessions](https://github.com/avidullu/agent-sessions) repo cloned locally
- Python 3.11+ for the Agent Sessions CLI tool

## One-Time Setup

### 1. Install the extension

```bash
# Clone and build
git clone https://github.com/avidullu/agent-session-router
cd agent-session-router
npm install
npm run compile

# Package and install
npx vsce package
code --install-extension agent-session-router-0.1.0.vsix
```

Or install from a pre-built `.vsix` file shared with you.

### 2. Configure the output directory

Open VS Code Settings (`Ctrl+,`) and set:

```jsonc
{
  "agentSessionRouter.outputDir": "~/Projects/Agent Sessions/archive"
}
```

If left empty, the extension auto-detects the Agent Sessions repo at
`~/Projects/Agent Sessions/archive`. If neither works, it falls back to
`~/.agent-sessions-staging/`.

### 3. That's it

The extension is ready. No Python setup needed on the VS Code side.

## Daily Workflow

### Option A — Manual (simplest)

```
1. Code all day with Copilot / DeepSeek / Grok / Continue / Cline
2. Ctrl+Shift+P → "Agent Session Router: Export All Sessions"
3. cd ~/Projects/Agent Sessions
4. python tools/agent_archive.py export --all
5. git add archive/ && git commit -m "archive: daily sync"
```

### Option B — Auto-Export

```
1. Ctrl+Shift+P → "Agent Session Router: Auto-Export — Monitor for New Sessions"
2. Sessions are exported automatically as you complete them
3. Periodically run the Python export to update the index
```

### Option C — Fully automated (scheduled)

Set up a scheduled task (Windows) or cron job (Linux/macOS) for the Python tool:

```bash
# Crontab (Linux/macOS) — runs daily at 2 AM
0 2 * * * cd ~/Projects/Agent-Sessions && python tools/agent_archive.py export --all
```

```powershell
# Windows Task Scheduler — runs daily
$action = New-ScheduledTaskAction -Execute "python" -Argument "tools/agent_archive.py export --all" -WorkingDirectory "$env:USERPROFILE\Projects\Agent Sessions"
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
Register-ScheduledTask -TaskName "AgentSessionExport" -Action $action -Trigger $trigger
```

## How Ingestion Works

When you run `python tools/agent_archive.py export --all`:

1. The Python tool exports its own sources (Codex, Claude, Gemini, Grok from WSL)
2. It reads `archive/.router-index.jsonl` — the manifest written by the VS Code extension
3. It merges router-produced sessions into `archive/index.jsonl`
4. It updates `archive/INDEX.md` (human-readable index)

After this, all Python commands see extension-produced sessions:

```bash
python tools/agent_archive.py status    # Shows Copilot + DeepSeek counts
python tools/agent_archive.py baseline  # Analyzes them alongside native sessions
```

## What You Don't Need

- ❌ Python installed for the extension to work — it runs entirely in VS Code
- ❌ VS Code open for the Python tool to work — it runs standalone
- ❌ Any shared configuration between the two tools
- ❌ Network access — everything is local

## Verifying It Works

```bash
# 1. Export VS Code sessions
#    Ctrl+Shift+P → "Agent Session Router: Export All Sessions"

# 2. Ingest into Agent Sessions
cd ~/Projects/Agent-Sessions
python tools/agent_archive.py export --all

# 3. Check the index
cat archive/index.jsonl | python -c "
import sys, json
for line in sys.stdin:
    r = json.loads(line)
    if r.get('source') in ('copilot-vscode', 'deepseek-vscode'):
        print(f\"{r['source']}: {r['messages']} messages\")
"

# Expected output:
# copilot-vscode: 2210 messages
# deepseek-vscode: 274 messages
```

## Adding Custom Agents

See the [Adding Custom Agents](README.md#adding-custom-agents) section in the
README. Any agent with discoverable session files can be supported by dropping
2 files into `discoverers/` and `extractors/` — no core code changes needed.
