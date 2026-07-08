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

## Adding Custom Agents

The extension is **pluggable** — users can add support for any AI coding agent
without modifying core files. Just drop two files into the right folders.

### Recipe (2 files, zero core edits)

**1. Discoverer** — `src/discoverers/my-agent.ts` — tells the extension WHERE to find session files:

```typescript
import { registerDiscoverer } from './index';
import { DiscoveredSession } from '../types';
import * as fs from 'fs';
import * as path from 'path';

async function* discoverMyAgent(): AsyncIterable<DiscoveredSession> {
    const sessionsDir = path.join(process.env.USERPROFILE || '~', '.my-agent', 'sessions');
    if (!fs.existsSync(sessionsDir)) return;
    for (const file of fs.readdirSync(sessionsDir)) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(sessionsDir, file);
        yield {
            sourceName: 'my-agent',
            sourceKind: 'my_agent',          // must match extractor kind
            filePath,
            sessionId: file.replace('.json', ''),
            sizeBytes: fs.statSync(filePath).size,
            mtimeMs: fs.statSync(filePath).mtimeMs,
        };
    }
}
registerDiscoverer('my_agent', () => discoverMyAgent());
```

**2. Extractor** — `src/extractors/my-agent.ts` — tells the extension HOW to parse session files:

```typescript
import { registerExtractor } from './index';
import { ExtractedSession } from '../types';
import * as fs from 'fs';

function extractMyAgent(filePath: string): ExtractedSession {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
        metadata: { session_id: raw.id, model: raw.model },
        messages: raw.conversation.map((m: any) => ({
            role: m.speaker === 'human' ? 'user' : 'assistant',
            text: m.text,
            timestamp: m.timestamp,
        })),
    };
}
registerExtractor('my_agent', extractMyAgent);
```

**3. Compile and reload** — that's it. The extension auto-discovers all modules
in `discoverers/` and `extractors/`. Config toggles work automatically:

```jsonc
// settings.json
"agentSessionRouter.sources": {
    "my_agent": { "enabled": true }
}
```

**No changes to `router.ts`, `config.ts`, or `package.json` needed.**

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type "Agent Session Router":

| Command | Description |
|---------|-------------|
| **Discover Sessions** | Scan and list all discoverable agent sessions |
| **Export All Sessions** | Export all discovered sessions to Markdown |
| **Export Selected Session** | Pick a specific session file to export |
| **Export Diagnostic Bundle** | Package logs + source samples for debugging |
| **Start Watching** | Begin auto-exporting sessions as they complete |
| **Stop Watching** | Stop the auto-export watcher |
| **Show Configuration** | Display current extension settings |

## Diagnostics & Debugging

When an export fails or produces unexpected output, the extension provides
structured diagnostics to help you (or your AI agent) diagnose the issue.

### Output Channel

All operations log to the **Agent Session Router** output channel
(`View` → `Output` → select "Agent Session Router" from the dropdown). This shows
human-readable timestamps, categories, and results.

### Diagnostic JSONL

Machine-readable diagnostics are written to:
```
{outputDir}/.router/diagnostics.jsonl
```

Each line is a JSON object with:
- `timestamp`, `level` (debug/info/warn/error), `category`
- `sourceKind`, `sourceFile`, `sessionId`
- `durationMs`, `messageCount`, `sizeBytes`, `digest`
- `error.name`, `error.message`, `error.stack`, `error.sourceSnippet` (for failures)

Query with `jq`:
```bash
# Show all errors
cat diagnostics.jsonl | jq 'select(.level=="error")'

# Show extraction failures with source snippets
cat diagnostics.jsonl | jq 'select(.level=="error" and .error.sourceSnippet)'

# Show export summary
cat diagnostics.jsonl | jq 'select(.category=="summary")'
```

### Diagnostic Bundle

Run **Export Diagnostic Bundle** from the Command Palette to package:
- `diagnostics.jsonl` — the full log
- `config.json` — current extension configuration (redacted)
- `sources/` — up to 10 raw source file snippets from failed extractions
- `summary.txt` — human-readable overview

Share the bundle folder with your AI agent or attach to a GitHub issue.

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
├── docs/
│   └── ADR-001-agent-session-routing.md  # Architecture Decision Record
├── src/
│   ├── extension.ts          # Entry point
│   ├── config.ts             # Extension configuration
│   ├── types.ts              # Shared types
│   ├── utils.ts              # Hashing, paths, timestamps
│   ├── logger.ts             # Structured dual-channel logger
│   ├── diagnostics.ts        # Diagnostic bundle exporter
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
