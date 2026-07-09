# Agent Session Router Plan

> Status: current as of 2026-07-09.
> Repo: <https://github.com/avidullu/agent-session-router>

This document is the active plan for the VS Code Agent Session Router. The old
phase roadmap is complete: the extension is now a working local feeder for the
Agent Sessions hub, with cross-platform CI and support for the main VS Code
agent transcript stores identified so far.

## 1. Current Product Shape

Agent Session Router discovers AI coding sessions from VS Code extension storage,
extracts structured messages, renders hub-compatible Markdown, and writes a
router sidecar (`.router-index.jsonl`) that the Agent Sessions hub merges into
tracked catalog metadata.

Rendered Markdown is intentionally local-first. The hub tracks durable metadata
(`archive/index.jsonl` and `archive/INDEX.md`) while transcript bodies stay on
the user's machine by default.

## 2. Supported Sources

| Source                                  | Storage Pattern                             | Status                                              |
| --------------------------------------- | ------------------------------------------- | --------------------------------------------------- |
| GitHub Copilot Chat                     | VS Code `workspaceStorage` JSONL/debug logs | Supported                                           |
| DeepSeek V4                             | VS Code `globalStorage` request dumps       | Supported                                           |
| Continue.dev                            | `~/.continue/sessions/`                     | Supported                                           |
| Cline                                   | VS Code `globalStorage` task history        | Supported                                           |
| Cody                                    | VS Code `globalStorage` chat history        | Supported                                           |
| Aider                                   | Project `.aider*` files                     | Supported                                           |
| Gemini Antigravity                      | `~/.gemini/antigravity/brain/` logs         | Supported                                           |
| Tabby, Codeium, Amazon Q                | Generic VS Code `globalStorage` fallback    | Supported where text/JSON session files are present |
| Grok, Claude, Gemini via VS Code LM API | Copilot Chat storage                        | Supported through `copilot_chat`                    |

The Agent Sessions hub continues to own direct CLI ingestion for Claude Code,
Codex CLI, Gemini CLI, Grok CLI, and other non-VS-Code sources.

## 3. Architecture

```text
VS Code storage
    -> discoverers/*       locate candidate files
    -> extractors/*        parse messages and metadata
    -> renderers/markdown  emit hub-compatible Markdown
    -> router.ts           hash, cache, write Markdown, write sidecar
    -> archive/.router-index.jsonl
    -> Agent Sessions hub export/index refresh
```

Design rules:

- Add new agents by registering one discoverer and one extractor.
- Keep the Markdown renderer byte-compatible with the hub contract fixtures.
- Keep router sidecar identity aligned with the hub catalog identity:
  `session_id + sha256`.
- Count export outcomes honestly: exported, skipped, and failed are separate
  states.
- Avoid full-file reads in hot paths where files can grow large; Gemini JSONL
  parsing and file hashing are chunked.

## 4. Quality Gates

Local and CI verification should cover:

```bash
npm test
npm run lint:check
npm run format:check
npm run compile
```

Current full test suite:

| Suite                  | Count |
| ---------------------- | ----: |
| Contract conformance   |     6 |
| Router index           |     6 |
| Router export outcomes |     5 |
| Coverage suite         |    80 |
| Smoke tests            |     6 |
| Total                  |   103 |

CI runs lint/format plus build-test across Windows, macOS, and Linux on Node 20
and Node 22. The PR labeler workflow is non-product CI and is currently allowed
to fail without blocking merges.

## 5. Recently Shipped

- Stable Gemini Antigravity `metadata.session_id` derived from the brain session
  directory.
- Router index identity now matches the hub: same session id with different
  payload hashes stays distinct.
- Documentation updated for local-only Markdown bodies in the hub repo.
- Gemini JSONL parsing and file hashing avoid full-file `readFileSync`.
- Batch export summary now separates skipped sessions from failed sessions.

## 6. Backlog

These are useful but not blocking:

| Priority | Item                                     | Notes                                                                                                      |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P2       | Tail-hash reuse hardening                | Add a small trailing-content fingerprint to cached records if coarse mtime/size checks prove insufficient. |
| P2       | Targeted generator APIs in the hub       | Only pursue if baseline/index scans show meaningful memory or latency pressure.                            |
| P3       | More source-specific extractor hardening | Promote generic globalStorage sources to dedicated extractors only after real sample files justify it.     |
| P3       | Packaging/publication polish             | Revisit marketplace packaging once private daily use stabilizes.                                           |

## 7. Open Questions

- Which generic globalStorage providers produce stable enough formats to deserve
  dedicated extractors?
- Should the router expose a small diagnostics command for export outcome totals,
  beyond the existing logs and diagnostic bundle?
- Do any supported VS Code extensions rotate or redact local transcripts in ways
  that require per-provider freshness checks?
