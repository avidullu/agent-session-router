# Agent Session Router — VS Code Extension

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/avidullu.agent-session-router?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=avidullu.agent-session-router)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/avidullu.agent-session-router)](https://marketplace.visualstudio.com/items?itemName=avidullu.agent-session-router)
[![CI](https://github.com/avidullu/agent-session-router/actions/workflows/ci.yml/badge.svg)](https://github.com/avidullu/agent-session-router/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC)](https://code.visualstudio.com/)
![Tests](https://img.shields.io/badge/tests-passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-86%20unit%20tests-blue)
![Agents](https://img.shields.io/badge/agents-8%20supported-9cf)

Automatically archive your AI coding sessions. Discovers conversations from
**Copilot Chat, DeepSeek, Continue, Cline, Cody, Aider, Gemini Antigravity,**
and more — exports them as searchable Markdown files into your
[Agent Sessions](https://github.com/avidullu/agent-sessions) archive.

> **Available on the Marketplace**:
> [marketplace.visualstudio.com/items?itemName=avidullu.agent-session-router](https://marketplace.visualstudio.com/items?itemName=avidullu.agent-session-router).
> Native Z.ai chat support, 8+ agent sources, cross-platform CI (Windows/macOS/Linux).

### New in 0.2.2: see what is being collected

**Collection Status** shows the archive folder, actual watcher state, enabled
sources, session/message counts, missing artifacts, and recorded export times.
**Open Archive** opens that folder in a new window without replacing your project.
Changing archive directories no longer reuses another directory's export cache.

Pair the router with [hub 0.3.0](https://pypi.org/project/agent-session-hub/0.3.0/)
using `agent-archive init` in a private workspace. Collection remains local and
auto-export remains opt-in. The Marketplace badge above shows the published
version; source release preparation alone does not update installed extensions.

### Included from 0.2.1: reliable automatic collection

Archive paths are now machine-specific, so Settings Sync cannot copy a Windows path
onto Linux or macOS. Existing invalid paths show a warning with a **Set Output Directory**
action. Choose a local archive folder or reset to auto-detect.

Changing **Auto-Export** takes effect immediately, including after repairing the path.
Startup reports whether collection is enabled without opening the Output panel.
Automatic archiving remains opt-in; existing history can be collected with **Export All Sessions**.

---

## Quick Start

### Option 1: Install from the VS Code Marketplace (Recommended)

Open the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=avidullu.agent-session-router)
and click **Install**, or from a terminal:

```bash
code --install-extension avidullu.agent-session-router
```

Run **Agent Session Router: Set Output Directory** to choose your private archive,
then **Export All Sessions** from the Command Palette (`Ctrl+Shift+P`). On 0.2.2,
use **Collection Status** to check the result and **Open Archive** to read it.

### Option 2: Install from VSIX

1. Download the latest `.vsix` from [Releases](https://github.com/avidullu/agent-session-router/releases)
2. Install:
   ```bash
   code --install-extension agent-session-router-0.2.2.vsix --force
   ```
3. **Reload VS Code** (`Ctrl+Shift+P` → "Developer: Reload Window")

### Option 3: Build from Source

```bash
git clone https://github.com/avidullu/agent-session-router.git
cd agent-session-router
npm ci
npm run compile
npm test                        # includes live collection and path recovery regressions
npx @vscode/vsce package -o agent-session-router.vsix
code --install-extension agent-session-router.vsix --force
```

Press `F5` in VS Code to launch the Extension Development Host instead of installing.

<details>
<summary>🤖 For AI Agents — Agentic Installation</summary>

If you're an AI coding agent setting this up for a user, run the **agentic
installation** script. It handles everything and prints the exact next steps:

```bash
# macOS / Linux / WSL
chmod +x scripts/agentic-install.sh
./scripts/agentic-install.sh --output-dir "$HOME/Projects/Agent Sessions/archive"
```

```powershell
# Windows PowerShell
.\scripts\agentic-install.ps1 -OutputDir "$env:USERPROFILE\Projects\Agent Sessions\archive"
```

The script will: verify Node.js ≥ 20, install dependencies, compile, run the
test suite, package the `.vsix`, install into VS Code, and print the
recommended settings.

Ask before enabling automatic export. Add `--auto-watch` / `-AutoWatch` only when
the owner explicitly wants it; do not silently enable it during installation.

After the script completes, tell the user:

> **Reload VS Code** (`Ctrl+Shift+P` → "Developer: Reload Window"), then
> run **Agent Session Router: Export All Sessions** from the Command Palette.

</details>

---

## What It Does

Your AI coding sessions are scattered across VS Code's internal storage. This
extension finds them all, extracts the conversations, and saves them as local
Markdown files that the Agent Sessions hub can index.

1. **Discover** — scan VS Code for sessions from 8+ agents
2. **Extract** — parse raw session data into structured conversation transcripts
3. **Export** — render as Markdown files compatible with the Agent Sessions archive
4. **Auto-Export** — optionally monitor for new sessions and export them automatically
5. **Pluggable** — add support for any AI agent by dropping 2 files

## Supported Agents

| Agent                             | Source                  | Status                                      |
| --------------------------------- | ----------------------- | ------------------------------------------- |
| **GitHub Copilot Chat**           | VS Code extension       | ✅ Native chat JSONL + current SQLite + legacy JSONL |
| **DeepSeek V4**                   | VS Code extension       | ✅ Full support                             |
| **Continue.dev**                  | VS Code extension       | ✅ Discover + Extract                       |
| **Cline**                         | VS Code extension       | ✅ Discover + Extract                       |
| **Cody (Sourcegraph)**            | VS Code extension       | ✅ Discover + Extract                       |
| **Aider**                         | VS Code extension       | ✅ Discover + Extract                       |
| **Gemini Antigravity**            | VS Code extension + IDE | ✅ Discover + Extract                       |
| **Tabby, Codeium, Amazon Q**      | VS Code extensions      | ✅ Via generic globalStorage                |
| **Z.AI, Grok, Claude, Gemini (LM API)** | VS Code native chat | ✅ Provider-aware native chat JSONL         |
| **OpenAI ChatGPT**                | Via Codex CLI           | ✅ Via Codex extractor                      |

> New agents are auto-discovered on the next scan — no configuration needed.

## Testing & Quality

| Metric                      | Value                               |
| --------------------------- | ----------------------------------- |
| **Test suite**              | Unit, contract, storage, and collection regressions on Node 22+ |
| Unit tests (coverage suite) | 86                                  |
| Contract conformance        | 6                                   |
| Router-index tests          | 6                                   |
| Router export outcome tests | 10                                  |
| Smoke tests                 | 6                                   |
| Collection regressions      | Path portability, live settings, Z.ai export, recovery, shutdown |
| **CI matrix**               | Windows, macOS, Linux × Node 20, 22 |
| **Linting**                 | ESLint (TypeScript) — 0 errors      |
| **Formatting**              | Prettier — enforced in CI           |

```bash
npm test          # Full suite: contract + index + coverage + smoke
npm run lint:check  # ESLint (0 errors)
npm run format:check # Prettier check
npm run ci:check    # All gates: lint → format → compile → test
```

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type "Agent Session Router":

| Command                      | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| **Discover Sessions**        | Scan and list all discoverable agent sessions  |
| **Collection Status**        | Inspect watcher state, archive health and counts |
| **Open Archive**             | Open the archive folder in a new VS Code window |
| **Export All Sessions**      | Export all discovered sessions to Markdown     |
| **Export Selected Session**  | Pick a specific session file to export         |
| **Set Output Directory**     | Choose where to save exported session files    |
| **Show Configuration**       | Display current extension settings             |
| **Start Watching**           | Begin auto-exporting sessions as they complete |
| **Stop Watching**            | Stop the auto-export watcher                   |
| **Export Diagnostic Bundle** | Package logs + source samples for debugging    |
| **Reset State**              | Clear all cached exports                       |

## Configuration

All settings are under the `agentSessionRouter` namespace.

```jsonc
{
    // Output directory for rendered Markdown files.
    // Use "Set Output Directory" command to pick a folder interactively.
    "agentSessionRouter.outputDir": "~/Projects/Agent Sessions/archive",

    // Per-source toggles (any discoverer kind works — pluggable)
    "agentSessionRouter.sources": {
        "copilot_chat": { "enabled": true },
        "deepseek_request_dump": { "enabled": true },
        "gemini_antigravity": { "enabled": true },
    },

    // Auto-export watcher
    "agentSessionRouter.watch.enabled": false,
    "agentSessionRouter.watch.debounceMs": 5000,

    // Optional exact Windows profile roots to include from Remote WSL.
    // Profiles are never enumerated automatically.
    "agentSessionRouter.windowsProfileRoots": ["C:\\Users\\your-name"],

    // Max age of sessions to export
    "agentSessionRouter.maxSessionAge": "90d",
}
```

## FAQ

### What does this extension do that the Agent Sessions Python tool doesn't?

The Agent Sessions Python tool handles **CLI tools** (Claude Code, Codex CLI,
Gemini CLI, Grok CLI). This extension handles **VS Code extensions** (Copilot Chat,
DeepSeek, Continue, Cline, etc.). Together they give you complete coverage of all
your AI coding sessions.

### Where are my exported sessions saved?

To a configurable directory (default: auto-detected `~/Projects/Agent Sessions/archive/`).
Use the **Set Output Directory** command to change it. Files follow the Agent Sessions
archive contract — they're ready to be indexed by the hub.

Keep the archive in a private workspace, separate from the public product repo.
The router also writes `.router-index.jsonl`; hub status reads it directly, and
`agent-archive export --all` merges it into the local catalog
(`archive/index.jsonl` and `archive/INDEX.md`). Catalog sync to a private remote
is optional, not part of ordinary collection.

### Does it support Copilot's current `session-store.db`?

Yes. Current Copilot Chat keeps sessions in
`globalStorage/github.copilot-chat/session-store.db`. The router opens the live
WAL-backed database read-only, exports each logical session independently, and
uses a per-session content revision so one changed conversation does not create
false cache hits for its siblings.

When the extension runs in Remote WSL, it can also discover an existing Windows
VS Code user store. It uses the current `USERPROFILE` when available, plus exact
profile roots explicitly listed in `agentSessionRouter.windowsProfileRoots`
(for example, `C:\\Users\\your-name` or `/mnt/c/Users/your-name`). It never
enumerates every profile under `/mnt/c/Users`, preventing another Windows
user's conversations from entering your archive.

SQLite-store ingestion needs a VS Code extension host with Node.js 22.5 or
newer. Current VS Code releases satisfy that requirement. On older extension
hosts, legacy Copilot transcript/debug JSONL discovery continues to work and the
Output panel reports why the SQLite store was skipped.

### What is the recommended daily routine?

1. Run **Agent Session Router: Set Output Directory** and select the Agent
   Sessions private workspace's `archive` directory.
2. Run **Agent Session Router: Export All Sessions** once.
3. If you want automatic collection, run **Agent Session Router: Auto-Export — Monitor for New Sessions**. The
   command starts collection immediately and persists the setting for future VS Code sessions.
4. In your hub workspace, run `agent-archive export --all` followed by
   `agent-archive status` whenever you want to refresh and inspect the catalog.
   Hub status reads routed sessions directly; another export is not required to see them.

### Connect the hub and inspect collection

With **agent-session-hub 0.3.0+**, install the hub with `pip install agent-session-hub`,
create a private workspace, and run `agent-archive init` there. Select the exact
directory it prints using **Agent Session Router: Set Output Directory**.
For an existing router folder, initialize its parent:
`agent-archive --repo-root /path/to init --archive-dir archive`.
The router folder must be a direct child of the hub workspace. Hub 0.3.0 is
published; upgrade older installations before using `init`.

**Agent Session Router: Collection Status** opens a read-only report with the
resolved output folder, actual watcher state, enabled/disabled sources, indexed
session and message counts, local Markdown bytes, last recorded successful export,
and collection errors. It does not run Python, read transcript bodies, or upload data.
Legacy records show an unknown export time; source modification time is not export time.
The report counts router-owned sessions, not CLI sessions collected separately by the hub.

**Agent Session Router: Open Archive** opens the output folder in a new VS Code
window, leaving your current project open. If status says `no_sessions`, check the
folder matches the hub's `archive_dir`, then export one conversation. `manual_only`
means Auto-Export is off (the default); enable it explicitly if desired. If watching
was requested but is `not_running`, check source directories and restart Auto-Export.
Counts from a damaged index are marked incomplete. Error history covers this activation,
not previous VS Code launches; index counts and recorded export times survive reloads.

The watcher updates `.router-index.jsonl` as it exports, so watched and manually
selected sessions enter the same hub-ingestion path as a full export.

The default resolver recognizes common `Projects`, lowercase `projects`, and
`Siva/infra/agent-sessions` checkouts. Headless or managed setups can set
`AGENT_SESSIONS_HOME` to the Agent Sessions repository root.

### Does this extension upload my sessions anywhere?

**No.** All processing happens locally on your machine. Sessions are read from VS Code's
internal storage, parsed, and written as local Markdown files. Nothing is sent over the network.

### How do I add support for a new AI agent?

Drop two files into `src/discoverers/` and `src/extractors/`, recompile, and restart.
See the [Adding Custom Agents](#adding-custom-agents) section below. No core edits needed.

### The watcher isn't auto-exporting my sessions. What's wrong?

1. Check the Output panel (`View` → `Output` → "Agent Session Router") for `[watcher]` events
2. Ensure `agentSessionRouter.watch.enabled` is `true`
3. Check that the output directory is an absolute path on this machine; use
   **Set Output Directory** to repair a path copied from another OS. `~/` is supported.
4. The watcher only exports sessions that are **modified after** it starts; use
   **Export All Sessions** for existing conversations, including Z.ai native chat history.
5. Run **Export Diagnostic Bundle** to collect logs for debugging

### Can I use this without the Agent Sessions repo?

Yes. The extension writes standalone Markdown files. You can read them directly.
The Agent Sessions repo adds indexing, search, and a knowledge baseline — entirely optional.

### What's the difference between "antigravity" and "antigravity-ide"?

Both are Gemini-powered AI coding tools. The extension auto-detects which variant
you use and handles both transparently. You don't need to configure anything.

### How do I update the extension?

Marketplace users can update from VS Code's Extensions view (or let automatic
extension updates run). Check the installed version there. A source clone is
not required. For an intentional source build:

```bash
git pull origin master
npm ci
npm run compile
npx @vscode/vsce package -o agent-session-router.vsix
code --install-extension agent-session-router.vsix --force
```

Or run `./scripts/agentic-install.sh` again — it's idempotent.

---

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
    const dir = path.join(process.env.USERPROFILE || '~', '.my-agent', 'sessions');
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const fp = path.join(dir, file);
        yield {
            sourceName: 'my-agent',
            sourceKind: 'my_agent',
            filePath: fp,
            sessionId: file.replace('.json', ''),
            sizeBytes: fs.statSync(fp).size,
            mtimeMs: fs.statSync(fp).mtimeMs,
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
        metadata: { session_id: raw.id },
        messages: raw.conversation.map((m: any) => ({
            role: m.speaker === 'human' ? 'user' : 'assistant',
            text: m.text,
            timestamp: m.timestamp,
        })),
    };
}
registerExtractor('my_agent', extractMyAgent);
```

**3. Compile and reload** — that's it. Config toggles work automatically:

```jsonc
"agentSessionRouter.sources": { "my_agent": { "enabled": true } }
```

---

## Output Format

The extension produces Markdown files matching the Agent Sessions contract:

```markdown
# deepseek-vscode / {session-id}

## Metadata

- Source: `deepseek-vscode`
- Kind: `deepseek_request_dump`
- Source file: `/path/to/source.json`
- SHA-256: `abc123...`
```

## Diagnostics & Debugging

All operations log to the **Agent Session Router** output channel
(`View` → `Output` → select "Agent Session Router" from the dropdown).

Run **Export Diagnostic Bundle** to package logs + source samples + config
into a portable folder for sharing with support or attaching to a GitHub issue.

---

## License

MIT — see [LICENSE](LICENSE).
