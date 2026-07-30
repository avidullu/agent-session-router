# Contributing to Agent Session Router

Thanks for your interest in contributing! This document covers how to set up,
test, and submit changes to the VS Code extension companion for
[agent-sessions](https://github.com/avidullu/agent-sessions).

## Setup

```bash
git clone https://github.com/avidullu/agent-session-router.git
cd agent-session-router
npm ci
npm run compile
```

Requirements: **Node.js 20+**.

## Gates — run before every push

```bash
npm run lint:check
npm run format:check
npm test
```

All three must pass. CI also runs them on Ubuntu, Windows, and macOS.

## Adding a custom agent source

Discoverers and extractors are pluggable:

1. Add a discoverer under `src/discoverers/` (find session files on disk).
2. Add an extractor under `src/extractors/` (parse messages into the contract).
3. Register both so the router index picks them up.
4. Add fixtures/tests under `test/`.
5. Run `npm test`.

See the [README](README.md#adding-custom-agents) for the full recipe and the
shared output contract in the hub:
[`docs/OUTPUT_CONTRACT.md`](https://github.com/avidullu/agent-sessions/blob/main/docs/OUTPUT_CONTRACT.md).

## PR workflow

1. Branch from `master` (fetch and update first).
2. Make one coherent change per PR.
3. Run the gates above — all green.
4. Push and open a PR (canonical merge target is the Forgejo remote when
   contributing as a maintainer; public GitHub is the mirror).
5. Address review comments, re-run gates, wait for LGTM.

## Code conventions

- TypeScript, strict compile (`npm run compile`)
- ESLint + Prettier (`src/**/*.ts` is LF via `.gitattributes`)
- Contract-conformance tests must stay green when touch renderers or indexes

## Related docs

- [README.md](README.md) — install, usage, architecture
- Hub [FAQ](https://github.com/avidullu/agent-sessions/blob/main/docs/FAQ.md)
- Hub [Getting Started](https://github.com/avidullu/agent-sessions/blob/main/docs/GETTING_STARTED.md)
