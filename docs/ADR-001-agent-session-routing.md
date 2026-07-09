# ADR-001: Agent Session Routing Extension Architecture

- **Status**: Accepted
- **Date**: 2026-07-08
- **Deciders**: @avidullu

---

## Context

The [Agent Sessions](https://github.com/avidullu/agent-sessions) repo is a
Python-based private archive for coding-agent session transcripts. It supports
Codex, Claude, Gemini, Grok, and DeepSeek — but has no live routing mechanism
for VS Code-based agents. VS Code Copilot Chat sessions are classified as
"inventory-only" with no extractor, and there is no real-time bridge between
VS Code's internal agent storage and the archive pipeline.

We need a VS Code extension that:
1. Discovers session files from VS Code's `globalStorage`/`workspaceStorage`
2. Extracts structured conversation transcripts
3. Renders them as Markdown compatible with the Agent Sessions format
4. Routes them to the archive directory
5. Supports the growing ecosystem of aggregator-backed agents (Continue, Cline,
   Cody, etc.) that use backends like Ollama and OpenRouter.

## Decision

### D1: Registry-based plugin architecture

Each agent source is supported via two independently registered modules:

- **Discoverer** — knows WHERE to find session files for a specific agent
- **Extractor** — knows HOW to parse those files into structured messages

Both use a simple key-value registry (`Map<string, Fn>`) with side-effect
registration on import. This mirrors the Python Agent Sessions `@register("kind")`
decorator pattern.

**Rationale**: Adding a new agent requires only two new files (~50 lines each)
with zero changes to existing code. The router pipeline (discover → extract →
render → write) is agent-agnostic.

### D2: Markdown output byte-compatible with Agent Sessions

The renderer produces the EXACT format used by `agent_sessions/render.py`:

```markdown
# {source_name} / {session_id}
## Metadata
- Source: `...`
- Kind: `...`
- SHA-256: `...`
...
## Transcript
### 1. user (...)
...
```

**Rationale**: The Python tool's indexer (`archive/index.jsonl`) can consume
extension-produced files without modification. No Python dependency in the
extension — the Python tool handles its own post-processing (indexing, PDF,
baseline analysis).

### D3: Idempotent exports via SHA-256 + size + mtime cache

Before extracting a session, the router checks an in-memory cache keyed by
`(filePath, size, mtime)`. Unchanged files are skipped. This mirrors the
`_can_reuse_record` logic in the Python tool.

**Rationale**: Prevents redundant extraction/rendering for sessions that have
already been exported. SHA-256 ensures content integrity; size+mtime provides
a fast pre-check.

### D4: Aggregator backends are transparent

Ollama, OpenRouter, LM Studio, and similar are model servers/API aggregators —
they are NOT VS Code extensions and do NOT store chat sessions. The VS Code
extensions that connect to them (Continue, Cline, Cody) ARE responsible for
session persistence.

Therefore the router targets VS Code extensions (Categories A & B), not
backends (Category C).

**Rationale**: Avoids the architectural mistake of trying to "discover" sessions
from backends that don't store them. The discoverer/extractor is always scoped
to the VS Code extension that owns the session data.

### D5: Structured logging with diagnostic export

All operations log to two channels:
1. **VS Code Output Channel** (`Agent Session Router`) — user-visible, human-readable
2. **Diagnostic JSONL** (`{outputDir}/.router/diagnostics.jsonl`) — machine-readable,
   append-only, for automated debugging

Each export operation records:
- Input file path, size, mtime, SHA-256
- Extractor used and extraction duration
- Number of messages extracted
- Output file path
- Errors with full stack traces and source file snippets

A `diagnosticBundle` command exports all diagnostic data + raw source samples
as a portable `.zip` for sharing with support/agents.

**Rationale**: When an export silently fails or produces unexpected output, the
user (or their agent) needs enough context to diagnose the issue without
re-running the session. The diagnostic bundle is small enough to attach to a
GitHub issue or share in a chat.

### D6: Pure TypeScript, no Python dependency

The extension runs entirely in the VS Code extension host. No Python
subprocess, no shelling out to `agent-archive`. The Agent Sessions Python tool
is a downstream consumer, not a runtime dependency.

**Rationale**: Keeps the extension self-contained and avoids coupling to the
Python tool's version, environment, or availability. The extension produces
files; the Python tool consumes them on its own schedule.

## Alternatives Considered

### A1: Single monolithic extractor with regex-based format detection

Rejected — fragile and unscalable. Each agent has its own JSON/JSONL schema;
regex-based detection would break on format changes and make adding new agents
a risky change to shared code.

### A2: Python subprocess bridge

Run `agent-archive export` from the extension via child process. Rejected —
introduces Python dependency, environment coupling, and performance overhead.
The extension should work even if the Python tool isn't installed.

### A3: Store rendered Markdown in extension globalState

Rejected — VS Code `globalState` is not designed for large blobs of text.
Filesystem output is the correct primitive; it integrates naturally with the
Agent Sessions repo (which is a Git repo of Markdown files).

### A4: Attempt to discover sessions from Ollama/OpenRouter APIs

Rejected — these backends don't store sessions. The VS Code extension that
USES the backend stores sessions. Targeting the wrong layer would produce
zero results.

## Consequences

### Positive

- Adding a new agent requires only 2 files, no existing code changes
- Output is immediately consumable by the Agent Sessions Python tool
- Aggregator-backed agents (Continue, Cline, etc.) are supported via the same
  discoverer+extractor recipe
- Diagnostic export enables self-service debugging

### Negative

- The extension must reverse-engineer each agent's storage format (no public
  API for session data in most VS Code extensions)
- Storage formats may change between extension versions — discoverers need
  version-pinning or format-detection guards
- Some agents may not persist sessions to disk at all (e.g., Z.AI appears to
  be in-memory only), making them unrouteable

### Neutral / follow-ups

- Future ADR may cover: watcher implementation (chokidar vs VS Code API),
  multi-machine sync strategy, privacy/redaction of exported content
