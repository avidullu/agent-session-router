# VS Code Agent Session Router — Architecture & Implementation Plan

## 1. Problem Statement

The **Agent Sessions** repo (`Projects/Agent Sessions`) is a Python-based private
archive for coding-agent sessions. It discovers, extracts, and exports agent
transcripts as Markdown/PDF files. Currently it supports Codex, Claude, Gemini,
Grok, and DeepSeek — but **VS Code Copilot Chat and other VS Code-based agents
have no live routing mechanism**. Their session data is scattered across
`globalStorage` and `workspaceStorage` directories that the Python tool can only
treat as static inventory.

### 1.1 What the Agent Sessions repo does today

| Step | Mechanism |
|------|-----------|
| **Discovery** | TOML-configured source roots with glob patterns |
| **Extraction** | Per-agent extractors (`@register("kind")`) that parse raw files → `ExtractedSession` |
| **Rendering** | `render.py` → Markdown with metadata header + transcript |
| **Indexing** | `archive/index.jsonl` + `archive/INDEX.md` |
| **Baseline** | Knowledge/replay system for analyzing archived sessions |

### 1.2 The gap

- **Copilot Chat**: listed as `inventory`-only. Sessions are in
  `workspaceStorage/*/GitHub.copilot-chat/debug-logs/` (JSONL) and
  `chat-session-resources/` but no extractor exists.
- **DeepSeek V4**: has a `deepseek_request_dump` extractor, but only captures raw
  request text — no structured conversation, no metadata enrichment.
- **No live routing**: the Python tool is batch-oriented. A VS Code extension
  can provide real-time or near-real-time routing of finished sessions.

---

## 2. Vision: The VS Code Agent Session Router Extension

A VS Code extension that acts as a **bridge** between VS Code's internal agent
session storage and the Agent Sessions archive pipeline. It is the first in a
suite of helper tools for processing agent session handoffs and transcripts.

### 2.1 Core capabilities

1. **Discover** — scan VS Code's `globalStorage` and `workspaceStorage` for
   agent session files (Copilot Chat, DeepSeek, and any future agent extensions).
2. **Extract** — parse raw session formats into structured conversation
   transcripts (user ↔ agent turns with tool calls).
3. **Render** — produce Markdown files in the exact format the Agent Sessions
   repo expects (metadata header + numbered transcript sections).
4. **Route** — place rendered Markdown files into a configurable output
   directory (default: the Agent Sessions `archive/` dir or a staging folder).
5. **Watch** — optional filesystem watcher that auto-exports sessions as they
   are completed or modified.

### 2.2 Extension architecture

```
┌─────────────────────────────────────────────────────────┐
│                 VS Code Extension Host                    │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Discover │  │ Extract  │  │  Render  │              │
│  │  Module  │  │  Module  │  │  Module  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  ┌────┴──────────────┴──────────────┴────┐              │
│  │           Router / Orchestrator        │              │
│  └────┬──────────────────────────────┬────┘              │
│       │                              │                    │
│  ┌────┴─────┐                  ┌─────┴─────┐            │
│  │  Watcher  │                  │  Commands  │            │
│  │ (optional)│                  │  & Config  │            │
│  └──────────┘                  └───────────┘            │
│                                                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
         ┌─────────────────────────┐
         │   Agent Sessions Repo    │
         │   archive/**/*.md        │
         │   archive/index.jsonl    │
         └─────────────────────────┘
```

### 2.3 Source agents to support (Phase 1)

| Agent | Storage Location | Format | Status |
|-------|-----------------|--------|--------|
| **Copilot Chat** | `workspaceStorage/*/GitHub.copilot-chat/debug-logs/` | JSONL (main.jsonl + models.json) | Inventory-only today |
| **Copilot Chat** | `workspaceStorage/*/GitHub.copilot-chat/chat-session-resources/` | Per-turn content files | New discovery |
| **DeepSeek V4** | `globalStorage/vizards.deepseek-v4-for-copilot/request-dumps/` | JSON request/response pairs | Basic extractor exists |
| **Gemini (VS Code)** | (to be discovered) | (TBD) | Future |
| **Z.AI / ZAI** | `extensions/ltmoerdani.zai-copilot-chat-*` | (TBD) | Future |

---

## 3. Detailed Implementation Plan

### Phase 1: Foundation — Extension Scaffold & Core Pipeline

**Goal**: Working extension that can discover, extract, and render sessions from
at least one source (DeepSeek), producing Markdown compatible with the Agent
Sessions repo.

#### 3.1 Project structure

```
extensions/
├── agent-session-router/          # VS Code extension
│   ├── .vscode/
│   │   ├── launch.json
│   │   └── tasks.json
│   ├── src/
│   │   ├── extension.ts           # Entry point: activate/deactivate
│   │   ├── config.ts              # Extension configuration
│   │   ├── discoverers/
│   │   │   ├── index.ts           # Discovery registry
│   │   │   ├── copilot-chat.ts    # Copilot Chat session discovery
│   │   │   └── deepseek.ts        # DeepSeek request-dump discovery
│   │   ├── extractors/
│   │   │   ├── index.ts           # Extractor registry
│   │   │   ├── copilot-chat.ts    # Copilot JSONL → messages
│   │   │   └── deepseek.ts        # DeepSeek JSON → messages
│   │   ├── renderers/
│   │   │   ├── index.ts           # Renderer registry
│   │   │   └── markdown.ts        # Markdown renderer (matching Agent Sessions format)
│   │   ├── router.ts              # Orchestrator: discover → extract → render → write
│   │   ├── watcher.ts             # Filesystem watcher (chokidar)
│   │   ├── commands.ts            # VS Code command registrations
│   │   └── utils.ts               # Shared utilities
│   ├── test/
│   │   ├── extension.test.ts
│   │   ├── discoverers.test.ts
│   │   ├── extractors.test.ts
│   │   └── renderers.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── .vscodeignore
│   └── README.md
├── PLAN.md                        # This document
└── .gitignore
```

#### 3.2 Key design decisions

1. **Extractor registry pattern** — same as Agent Sessions' `@register("kind")`
   decorator, but in TypeScript. Each agent source gets a registered extractor.
2. **Markdown format compatibility** — the renderer MUST produce the exact
   format that Agent Sessions expects:
   ```markdown
   # {source_name} / {session_id}
   ## Metadata
   - Source: `{source_name}`
   - Kind: `{source_kind}`
   - Source file: `{path}`
   - SHA-256: `{digest}`
   - Source modified: `{timestamp}`
   - Imported at: `{timestamp}`
   ## Transcript
   ### 1. user (2024-01-01T00:00:00Z)
   {message text}
   ### 2. assistant (2024-01-01T00:00:01Z)
   {message text}
   ```
3. **Output routing** — configurable destination:
   - `agentSessions.archiveDir`: direct write into Agent Sessions archive
   - `agentSessions.stagingDir`: write to a staging area for manual review
   - `agentSessions.outputDir`: generic output directory
4. **Idempotent exports** — use SHA-256 of source file + size+mtime to skip
   already-exported sessions (same as Agent Sessions' `_can_reuse_record`).
5. **Extension runs purely in VS Code** — no Python dependency. The Agent
   Sessions repo does its own post-processing (indexing, PDF, baseline).

#### 3.3 Commands

| Command | Description |
|---------|-------------|
| `agentSessionRouter.discover` | Scan and report all discoverable agent sessions |
| `agentSessionRouter.exportAll` | Export all discovered sessions to Markdown |
| `agentSessionRouter.exportSession` | Export a specific session file |
| `agentSessionRouter.watchStart` | Start filesystem watcher for auto-export |
| `agentSessionRouter.watchStop` | Stop filesystem watcher |
| `agentSessionRouter.showConfig` | Show current extension configuration |

#### 3.4 Configuration (contributes.configuration)

```jsonc
{
  "agentSessionRouter.enabled": true,
  "agentSessionRouter.outputDir": "~/Projects/Agent Sessions/archive",
  "agentSessionRouter.sources": {
    "copilotChat": { "enabled": true },
    "deepseek": { "enabled": true }
  },
  "agentSessionRouter.watch": {
    "enabled": false,
    "debounceMs": 5000
  },
  "agentSessionRouter.maxSessionAge": "90d"
}
```

### Phase 2: Copilot Chat Extractor

**Goal**: Build a proper extractor for VS Code Copilot Chat sessions.

**Challenge**: Copilot Chat session data is split across:
- `debug-logs/{uuid}/main.jsonl` — session timeline events
- `debug-logs/{uuid}/models.json` — model/tool metadata
- `chat-session-resources/{uuid}/call_*__vscode-*/content.txt` — actual message content

The extractor needs to:
1. Discover session UUIDs from `debug-logs/` directories
2. Parse `main.jsonl` for the session timeline (user messages, assistant responses, tool calls)
3. Cross-reference `chat-session-resources/` for actual message content
4. Reconstruct full conversation turns

### Phase 3: Watcher & Auto-Export

**Goal**: Optional real-time routing using `chokidar` or VS Code's
`FileSystemWatcher`.

- Watch `workspaceStorage` and `globalStorage` for new/modified session files
- Debounce (default 5s) to avoid partial writes
- Auto-export completed sessions to the configured output directory

### Phase 4: DeepSeek Enhanced Extractor

**Goal**: Upgrade the DeepSeek extractor from raw request dump to structured
conversation.

DeepSeek's `request-dumps/` stores:
- `deepseek-provider-input-*.json` — full provider input with system prompt + messages
- `deepseek-request-*.input.json` — the actual request body
- `deepseek-request-*.json` — the request metadata

Enhanced extractor should:
1. Parse the provider input to extract the full message array
2. Separate system prompt, user messages, and assistant responses
3. Include tool call/result pairs as structured sections

### Phase 5: Suite Expansion

Future helper tools that share infrastructure with the router:

| Tool | Purpose |
|------|---------|
| **Session Handoff Generator** | Auto-generate `SESSION_HANDOFF.md` from recent sessions |
| **Transcript Search** | Full-text search across archived sessions |
| **Session Diff** | Compare sessions across agents/versions |
| **Baseline Reporter** | Generate baseline compliance reports from session data |
| **Chat Exporter** | Export current chat panel session directly |

---

## 4. Technical Details

### 4.1 TypeScript Extractor Interface

```typescript
interface ExtractedSession {
  metadata: Record<string, unknown>;
  messages: SessionMessage[];
}

interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'request-prompt';
  text: string;
  timestamp?: string;
  toolCallId?: string;
  toolName?: string;
}

type Extractor = (filePath: string) => ExtractedSession;
```

### 4.2 Discovery Interface

```typescript
interface DiscoveredSession {
  sourceName: string;      // e.g., "copilot-vscode-windows"
  sourceKind: string;      // e.g., "copilot_chat"
  filePath: string;        // absolute path to source file
  sessionId: string;       // unique session identifier
  sizeBytes: number;
  mtimeMs: number;
}
```

### 4.3 Renderer Output

The renderer must produce Markdown that is **byte-for-byte compatible** with
what the Agent Sessions Python `render.py` produces for the same session data.
This ensures seamless integration — the Agent Sessions indexer can pick up
extension-produced files without modification.

### 4.4 Integration with Agent Sessions repo

The extension writes Markdown files directly into:
```
{agentSessionsRepo}/archive/{source_name}/{session_id}.md
```

The Agent Sessions `archive/index.jsonl` will be updated by the Python tool
on its next run, picking up the extension-produced files. Alternatively, the
extension could also write a companion index entry.

---

## 5. Success Criteria

1. ✅ Extension discovers DeepSeek sessions from `globalStorage`
2. ✅ Extension extracts structured messages from DeepSeek request dumps
3. ✅ Extension renders Markdown compatible with Agent Sessions format
4. ✅ Extension writes output to configurable directory
5. ✅ Copilot Chat sessions are discoverable and extractable
6. ✅ Watcher auto-exports new sessions
7. ✅ Agent Sessions Python tool can consume extension-produced Markdown
   without modification (verified by `python tools/agent_archive.py export`)
8. ✅ Extension published to VS Code Marketplace (or private `.vsix` distribution)

---

## 6. Repository Setup

- **Repo name**: `agent-session-router` (or `vscode-agent-tools`)
- **Location**: `c:\Users\avidu\Projects\Extensions`
- **Visibility**: Private (GitHub)
- **Remote**: `https://github.com/avidullu/agent-session-router`
- **Monorepo strategy**: This repo hosts the VS Code extension. Future helper
  tools can be added as separate packages in a monorepo under `packages/`.

---

## 7. Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| Phase 1: Foundation | 3-5 days | TypeScript, VS Code Extension API |
| Phase 2: Copilot Extractor | 3-4 days | Understanding Copilot session format |
| Phase 3: Watcher | 1-2 days | chokidar or vscode FileSystemWatcher |
| Phase 4: DeepSeek Enhanced | 2-3 days | DeepSeek dump format analysis |
| Phase 5: Suite Expansion | Ongoing | Prior phases complete |

---

## 8. Open Questions

1. **Copilot Chat session format stability**: Is the `debug-logs` / `chat-session-resources`
   format stable across VS Code versions, or does it change? Need to test across
   Insider/Stable builds.
2. **Extension marketplace vs private distribution**: Should this be published
   publicly or distributed as a private `.vsix`?
3. **Multi-machine sync**: How should the extension handle machines that share
   the Agent Sessions repo but have different VS Code storage layouts?
4. **Session privacy**: Agent sessions contain file contents, credentials, and
   sensitive data. The extension must not accidentally expose these. Markdown
   output goes to a private repo only.
