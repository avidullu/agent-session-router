# Changelog

## Unreleased

- Add Collection Status and Open Archive commands: watcher/source state, counts,
  persisted successful export times, missing artifacts, and current-activation errors.
- Keep export cache entries separate when changing output directories.
- Correct the hub command to `agent-archive` and document the private router/hub setup.
- No telemetry, default watcher enablement, hub installation, or release publication.

## 0.2.1 — 2026-09-15

- Output directories and Windows profile roots are now machine-specific settings, preventing Settings Sync from copying them to another operating system.
- Invalid, relative, or foreign-OS archive paths show an actionable warning instead of creating an unintended directory. `~/` paths now expand correctly.
- Auto-export starts and stops immediately when its setting changes. Repairing the output path resumes enabled collection without another reload.
- Disabled sources are respected by auto-export. Watchers stop when the extension is disabled or deactivated.
- The VSIX now includes the production file-watcher dependency instead of unintentionally excluding it from the package.
- Startup reports whether automatic collection is enabled and shows the installed extension version. It no longer opens the Output panel automatically.
- Z.ai and other native VS Code provider conversations continue to export from saved chat history, including visible assistant responses.

Automatic archiving remains opt-in. Run **Set Output Directory**, then **Auto-Export — Monitor for New Sessions** to enable it. Use **Export All Sessions** to collect existing history.
