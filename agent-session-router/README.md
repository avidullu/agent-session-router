# Agent Session Router — VS Code Extension

Routes VS Code AI agent session transcripts as Markdown files for the
[Agent Sessions](https://github.com/avidullu/agent-sessions) archive pipeline.

## What It Does

VS Code AI extensions (Copilot Chat, DeepSeek V4, etc.) store session
transcripts in internal storage directories (`globalStorage`,
`workspaceStorage`). This extension:

1. **Discovers** agent sessions across all configured VS Code storage locations
2. **Extracts** structured conversation messages (user ↔ assistant turns)
3. **Renders** Markdown files compatible with the Agent Sessions archive format
4. **Routes** the output to a configurable directory (default: Agent Sessions `archive/`)
5. **Watches** for new sessions (optional auto-export)

## Supported Agents

| Agent | Status |
|-------|--------|
| **DeepSeek V4 for Copilot** | ✅ Discover + Extract |
| **GitHub Copilot Chat** | ✅ Discover + Extract (beta) |
| **Gemini (VS Code)** | 🔜 Planned |
| **Z.AI / ZAI** | 🔜 Planned |

## Installation

### From Source (Development)

```bash
cd agent-session-router
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host.

### From VSIX (Private Distribution)

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension agent-session-router-0.1.0.vsix
```

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type "Agent Session Router":

| Command | Description |
|---------|-------------|
| **Discover Sessions** | Scan and list all discoverable agent sessions |
| **Export All Sessions** | Export all discovered sessions to Markdown |
| **Export Selected Session** | Pick a specific session file to export |
| **Start Watching** | Begin auto-exporting sessions as they complete |
| **Stop Watching** | Stop the auto-export watcher |
| **Show Configuration** | Display current extension settings |

## Configuration

```jsonc
{
  // Enable/disable the extension
  "agentSessionRouter.enabled": true,

  // Output directory for rendered Markdown files
  // Default: auto-detect Agent Sessions repo archive/ dir
  "agentSessionRouter.outputDir": "~/Projects/Agent Sessions/archive",

  // Per-source toggles
  "agentSessionRouter.sources.copilotChat.enabled": true,
  "agentSessionRouter.sources.deepseek.enabled": true,

  // Auto-watch settings
  "agentSessionRouter.watch.enabled": false,
  "agentSessionRouter.watch.debounceMs": 5000,

  // Max age of sessions to export (empty = no limit)
  "agentSessionRouter.maxSessionAge": "90d"
}
```

## Output Format

The extension produces Markdown files that match the Agent Sessions
Python `render.py` output format:

```markdown
# deepseek-vscode / {session-id}
## Metadata
- Source: `deepseek-vscode`
- Kind: `deepseek_request_dump`
- Source file: `/path/to/source.json`
- SHA-256: `abc123...`
- Source modified: `2026-07-08T10:00:00Z`
- Imported at: `2026-07-08T10:05:00Z`
## Transcript
### 1. user (2026-07-08T09:00:00Z)
Hello, can you help me with...
### 2. assistant (2026-07-08T09:00:05Z)
Certainly! Let me look at that...
```

## Integration with Agent Sessions Repo

1. Configure `agentSessionRouter.outputDir` to point to your Agent Sessions
   `archive/` directory
2. Run **Export All Sessions** to populate the archive
3. Run the Agent Sessions Python tool as usual:
   ```powershell
   python tools/agent_archive.py export --all
   ```
   The Python tool will index the extension-produced files alongside its own.

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Lint
npm run lint

# Run tests
npm test
```

## Project Structure

```
agent-session-router/
├── src/
│   ├── extension.ts          # Entry point
│   ├── config.ts             # Extension configuration
│   ├── types.ts              # Shared types
│   ├── utils.ts              # Hashing, paths, timestamps
│   ├── commands.ts           # VS Code command registrations
│   ├── router.ts             # Orchestrator pipeline
│   ├── watcher.ts            # Filesystem watcher
│   ├── discoverers/
│   │   ├── index.ts          # Discoverer registry
│   │   ├── deepseek.ts       # DeepSeek session discovery
│   │   └── copilot-chat.ts   # Copilot Chat session discovery
│   ├── extractors/
│   │   ├── index.ts          # Extractor registry
│   │   ├── deepseek.ts       # DeepSeek JSON → messages
│   │   └── copilot-chat.ts   # Copilot JSONL → messages
│   └── renderers/
│       └── markdown.ts       # Markdown renderer
├── test/
├── package.json
├── tsconfig.json
└── README.md
```

## License

Private — for personal use with the Agent Sessions archive.
