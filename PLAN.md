# VS Code Agent Session Router — Architecture & Implementation Plan

> **🏁 CHECKPOINT 1 — 2026-07-08** ✅ Merged  
> Phase 1 (Foundation) complete: scaffold, types, registries, router, DeepSeek extractor.  
> ADR-001 accepted. Structured logging + diagnostic bundle operational.  
>
> **🏁 CHECKPOINT 2 — 2026-07-08** (this PR)  
> Phase 2 (Copilot enhanced extractor) + Phase 3 (Watcher) complete.  
> Copilot extractor now uses `transcripts/{uuid}.jsonl` as primary source with  
> `chat-session-resources/` cross-referencing for tool output.  
> Watcher implemented with chokidar for cross-platform filesystem monitoring.  
> 9 tests passing (6 smoke + 3 integration).  
> **Next**: Phase 5 (Aggregator agents — Continue, Cline, Cody).  
> Repo: <https://github.com/avidullu/agent-session-router>

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

### 2.3 Agent taxonomy — four categories

The extension must handle a diverse ecosystem of AI coding agents. They fall into
four categories based on WHERE and HOW they store session data:

#### Category A: Native VS Code Extensions (persist to VS Code storage)

These are first-class VS Code extensions that use VS Code's storage APIs.
Session data lives in `globalStorage` or `workspaceStorage`.

| Agent | Extension ID | Storage Location | Format | Status |
|-------|-------------|-----------------|--------|--------|
| **Copilot Chat** | `github.copilot-chat` | `workspaceStorage/*/github.copilot-chat/debug-logs/` | JSONL | ✅ Discoverer exists |
| **Copilot Chat** | `github.copilot-chat` | `workspaceStorage/*/github.copilot-chat/chat-session-resources/` | Per-turn `.txt` | 🔧 Phase 2 |
| **DeepSeek V4** | `vizards.deepseek-v4-for-copilot` | `globalStorage/vizards.deepseek-v4-for-copilot/request-dumps/` | JSON | ✅ Full support |
| **Z.AI / ZAI** | `ltmoerdani.zai-copilot-chat` | Reuses Copilot Chat storage (model-provider fork) | JSONL | ✅ Via copilot_chat |
| **OpenAI ChatGPT** | `openai.chatgpt` | Uses bundled Codex CLI → `~/.codex/sessions/` | JSONL | ✅ Via Codex extractor |
| **Grok (X.AI)** | *(VS Code LM API)* | Uses Copilot Chat storage via VS Code's "Set X.AI API Key" mechanism. All transcripts show `producer: copilot-agent` — model choice is not recorded in metadata. | JSONL | ✅ Via copilot_chat |
| **Any LM API key model** | *(VS Code LM API)* | Same as above — Claude, Gemini, Grok, or any model added via VS Code's "Set API Key" command routes through Copilot Chat's transcript storage. No separate discoverer needed. | JSONL | ✅ Via copilot_chat |
| **Gemini (VS Code)** | (TBD) | (TBD) | (TBD) | 🔮 Research needed |

#### Category B: Aggregator-Backed VS Code Extensions

These are VS Code extensions that connect to multiple LLM backends (Ollama,
OpenRouter, LM Studio, etc.). The backend is irrelevant to session storage —
the extension itself persists sessions.

| Agent | Extension ID | Backends | Storage Location | Format | Status |
|-------|-------------|----------|-----------------|--------|--------|
| **Continue** | `continue.continue` | Ollama, OpenAI, Anthropic, OpenRouter, LM Studio, etc. | `~/.continue/sessions/` | JSON | 🔧 Planned |
| **Cline** | `saoudrizwan.claude-dev` | Ollama, OpenAI, Anthropic, OpenRouter, etc. | `globalStorage/saoudrizwan.claude-dev/` | JSON/JSONL | 🔧 Planned |
| **Cody** | `sourcegraph.cody` | Sourcegraph + BYOK | `globalStorage/sourcegraph.cody/` | Custom | 🔧 Planned |
| **Roo Cline** | `rooveterinaryinc.roo-cline` | Ollama, OpenAI, Anthropic, etc. | `globalStorage/rooveterinaryinc.roo-cline/` | JSON/JSONL | 🔧 Planned |
| **Aider (via VS Code)** | `aider.aider-vscode` | Ollama, OpenAI, Anthropic, etc. | Project `.aider*` files | Markdown/JSON | 🔧 Planned |
| **Tabby** | `tabbyml.tabby` | Self-hosted | `globalStorage/tabbyml.tabby/` | Custom | 🔧 Planned |
| **Codeium** | `codeium.codeium` | Proprietary | `globalStorage/codeium.codeium/` | Custom | 🔧 Planned |
| **Augment** | `augmentcode.augment` | Proprietary | `globalStorage/augmentcode.augment/` | Custom | 🔧 Planned |
| **Supermaven** | `supermaven.supermaven` | Proprietary | `globalStorage/supermaven.supermaven/` | Custom | 🔧 Planned |
| **Amazon Q** | `amazonwebservices.amazon-q-vscode` | AWS Bedrock | `globalStorage/amazonwebservices.amazon-q-vscode/` | Custom | 🔧 Planned |

#### Category C: Model Servers & API Aggregators (NOT VS Code extensions)

These do NOT store chat sessions themselves. They are backends that Category B
extensions connect to. They are listed here for completeness — the
agent-session-router does NOT interact with them directly.

| Server | Type | Notes |
|--------|------|-------|
| **Ollama** | Local model server | Runs Llama, Mistral, Qwen, DeepSeek, etc. locally. No session storage. |
| **LM Studio** | Local model server | GUI + API for local models. No session storage. |
| **vLLM** | Local model server | High-throughput serving. No session storage. |
| **LocalAI** | Local model server | OpenAI-compatible local API. No session storage. |
| **OpenRouter** | API aggregator | Unified API for 200+ models. No session storage. |
| **Groq** | API aggregator | Fast inference API. No session storage. |
| **Together AI** | API aggregator | Open-source model API. No session storage. |
| **Fireworks AI** | API aggregator | Fast model serving API. No session storage. |
| **DeepInfra** | API aggregator | Hosted open-source models. No session storage. |
| **AWS Bedrock** | API aggregator | Managed foundation models. No session storage. |
| **Google Vertex AI** | API aggregator | Managed ML platform. No session storage. |

#### Category D: Terminal/CLI Tools (persist outside VS Code)

These are standalone CLI tools used alongside VS Code. Sessions are stored
independently of VS Code. Already covered by the Agent Sessions Python tool.

| Tool | Storage Location | Format | Agent Sessions Status |
|------|-----------------|--------|----------------------|
| **Claude Code** | `~/.claude/projects/{project}/*.jsonl` | JSONL | ✅ Supported |
| **Codex CLI** | `~/.codex/sessions/` | JSONL | ✅ Supported |
| **Gemini CLI** | `~/.gemini/antigravity/brain/` | JSONL | ✅ Supported |
| **Grok CLI** | `~/.grok/sessions/` | JSONL | ✅ Supported |
| **Aider CLI** | Project `.aider*` files | Markdown/JSON | 🔧 Planned (Agent Sessions) |
| **Qwen CLI** | (TBD) | (TBD) | 🔮 Research needed |
| **Kimi CLI** | (TBD) | (TBD) | 🔮 Research needed |

### 2.4 Why aggregators are transparent to the architecture

The key insight: **model backends (Ollama, OpenRouter, LM Studio) are just API
endpoints**. They do not persist chat sessions. The VS Code extension that uses
them (Continue, Cline, etc.) is responsible for session storage.

This means the agent-session-router needs discoverers/extractors for the VS Code
EXTENSIONS (Category B), not for the backends (Category C). Once an extension's
storage format is understood, the router handles it identically regardless of
which backend model was used.

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Ollama       │     │  Continue.dev     │     │  agent-session- │
│  (backend)    │◄────│  (VS Code ext)    │────►│  router          │
│  No storage   │     │  ~/.continue/     │     │  → archive/*.md │
└──────────────┘     └──────────────────┘     └─────────────────┘

┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OpenRouter   │     │  Cline            │     │  agent-session- │
│  (backend)    │◄────│  (VS Code ext)    │────►│  router          │
│  No storage   │     │  globalStorage/   │     │  → archive/*.md │
└──────────────┘     └──────────────────┘     └─────────────────┘
```

Adding a new aggregator-backed extension always follows the same 3-step recipe:
1. **Install** the extension + run a test session
2. **Locate** its session storage (check `globalStorage/{id}/`, `~/.{name}/`)
3. **Write** a discoverer + extractor (~50 lines of TypeScript each)

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
│   │   │   ├── deepseek.ts        # DeepSeek request-dump discovery
│   │   │   ├── continue.ts        # Continue.dev sessions (Phase 5)
│   │   │   ├── cline.ts           # Cline task history (Phase 5)
│   │   │   └── cody.ts            # Cody chat history (Phase 5)
│   │   ├── extractors/
│   │   │   ├── index.ts           # Extractor registry
│   │   │   ├── copilot-chat.ts    # Copilot JSONL → messages
│   │   │   ├── deepseek.ts        # DeepSeek JSON → messages
│   │   │   ├── continue.ts        # Continue JSON → messages (Phase 5)
│   │   │   ├── cline.ts           # Cline JSONL → messages (Phase 5)
│   │   │   └── cody.ts            # Cody format → messages (Phase 5)
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
    // Category A: Native VS Code Extensions
    "copilotChat": { "enabled": true },
    "deepseek": { "enabled": true },
    "openaiChatGPT": { "enabled": true },
    "gemini": { "enabled": false },
    // Category A forks (share storage with parent)
    "zai": { "enabled": true, "note": "Z.AI reuses Copilot Chat storage" },
    // Category B: Aggregator-Backed Extensions
    "continue": { "enabled": false },
    "cline": { "enabled": false },
    "cody": { "enabled": false },
    "rooCline": { "enabled": false },
    "aiderVscode": { "enabled": false },
    "tabby": { "enabled": false },
    "codeium": { "enabled": false },
    "augment": { "enabled": false },
    "supermaven": { "enabled": false },
    "amazonQ": { "enabled": false }
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

### Phase 5: Aggregator-Backed Agent Support

**Goal**: Add discoverers and extractors for all major aggregator-backed VS Code
extensions (Category B). Each follows the same recipe: install → locate storage →
write discoverer + extractor.

**Priority order** (by popularity + likelihood of disk persistence):

| Priority | Agent | Why First |
|----------|-------|-----------|
| P1 | **Continue.dev** | Most popular open-source AI extension; known to persist to `~/.continue/sessions/` as JSON |
| P1 | **Cline** | Fast-growing; persists task history to globalStorage |
| P2 | **Cody** | Sourcegraph's assistant; enterprise adoption |
| P2 | **Aider (VS Code)** | Terminal tool with VS Code integration; `.aider*` files in project dir |
| P3 | **Tabby** | Self-hosted; growing corporate adoption |
| P3 | **Codeium** | Popular free-tier alternative to Copilot |
| P3 | **Amazon Q** | AWS ecosystem integration |

**Validation approach per agent**:
1. Install the extension from VS Code Marketplace
2. Run a test coding session with a known prompt
3. Locate session files: `globalStorage/{id}/`, `~/.{name}/`, workspace dirs
4. Document the storage format (JSON, JSONL, custom)
5. Implement discoverer + extractor
6. Test round-trip: extract → render → verify Markdown
7. Add to configuration schema as a toggleable source

### Phase 6: Suite Expansion

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
6. 🔧 Continue.dev sessions discoverable and extractable (Phase 5)
7. 🔧 Cline sessions discoverable and extractable (Phase 5)
8. 🔧 Watcher auto-exports new sessions (Phase 3)
9. 🔧 At least 3 aggregator-backed agents fully supported (Phase 5)
10. 🔧 Agent Sessions Python tool can consume extension-produced Markdown
   without modification (verified by `python tools/agent_archive.py export`)
11. 🔧 Extension published as private `.vsix` for distribution

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
| Phase 1: Foundation | ✅ Done | TypeScript, VS Code Extension API |
| Phase 2: Copilot Extractor | 3-4 days | Understanding Copilot session format |
| Phase 3: Watcher | 1-2 days | chokidar or vscode FileSystemWatcher |
| Phase 4: DeepSeek Enhanced | 2-3 days | DeepSeek dump format analysis |
| Phase 5: Aggregator Agents | ~1 day/agent | Installing + reverse-engineering each extension's storage |
| Phase 6: Suite Expansion | Ongoing | Prior phases complete |

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
5. **Aggregator extension storage stability**: Do extensions like Continue/Cline
   guarantee stable on-disk formats, or do they change between versions? Need
   to pin tested versions and detect format changes.
6. **Which aggregator extensions ACTUALLY persist sessions to disk?** Some may
   keep everything in-memory (like Z.AI appears to). Need to verify per-extension
   before writing discoverers. The table in §2.3 marks known persistence;
   agents marked 🔮 need on-machine verification.
7. **Ollama/Kimi/Qwen as first-class agents**: If a native VS Code extension
   ships for Ollama, Kimi, or Qwen (independent of aggregators like Continue),
   they would be Category A agents and follow the standard discoverer+extractor
   recipe.
8. **Conflict resolution**: If both the Agent Sessions Python tool AND the
   VS Code extension export the same session (e.g., Codex via both paths),
   the idempotent SHA-256 + size+mtime cache prevents duplication, but the
   metadata `source_name` may differ. Should the extension adopt the same
   `source_name` convention as the Python tool's `default_sources.toml`?
