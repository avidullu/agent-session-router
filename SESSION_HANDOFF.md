# Session Handoff

Updated: 2026-07-23 (CI hardening + Marketplace publish)

## You Are Here

The router is stable at v0.1.0 (107 tests, 8 agent sources, cross-platform CI).
The companion hub repo (`../agent-sessions`) has a public-launch tracker
(`docs/PUBLIC_LAUNCH_TRACKER.md`) covering both repos.

This PR adds CI hardening and Marketplace publishing infrastructure (L7):

- **PII scan job** — grep-based guard against personal user paths in tracked files
- **Link-check job** — internal markdown link validation (excludes archives)
- **Publish workflow** — `vsce publish` + `ovsx publish` on `v*` tag push

## Next Steps / Open Threads

- Review and merge this CI-hardening PR.
- After merge, create a publisher token and push a `v0.1.0` tag to trigger the
  publish workflow.
- L8 (Prettier drift fix) remains as a separate future PR.
- Backlog: tail-hash idempotency (P2), targeted generator APIs (P2),
  source-specific extractor hardening (P3).

## Ramp-Up Kit

- Hub public-launch tracker: `../agent-sessions/docs/PUBLIC_LAUNCH_TRACKER.md`
- `src/extension.ts` — activation entry point
- `src/router.ts` — discover → extract → render → write pipeline
- `src/discoverers/` — 8 agent source discoverers (pluggable registry)
- `src/extractors/` — 8 agent source extractors
- `src/renderers/markdown.ts` — OUTPUT_CONTRACT v1 byte-compatible renderer
- `PLAN.md` — architecture and backlog
- `docs/ADR-001-agent-session-routing.md` — architectural decisions

## Key Decisions

- **Local-first, no telemetry.** All processing happens on the user's machine.
- **Pluggable architecture.** New agents = one discoverer + one extractor file (ADR-001, D1).
- **OUTPUT_CONTRACT v1** byte-compatible Markdown with the hub (ADR-001, D2).
- **Idempotent exports** via SHA-256 + size + mtime + tail-hash cache (ADR-001, D3).
- **Publish targets**: VS Code Marketplace + Open VSX (per hub D4).
