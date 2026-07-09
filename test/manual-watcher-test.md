# Watcher Integration Test — Manual Verification

> **Issue #3** — The filesystem watcher cannot be fully tested by automated Node.js
> scripts because it requires the VS Code Extension Development Host (live
> `vscode.workspace.createFileSystemWatcher`, chokidar with real FS events).
>
> This document describes the manual verification procedure. Run it once per
> release or after watcher-related changes.
>
> Automated unit tests for the watcher's pure functions (`isSessionFile`,
> `determineSourceKind`, `extractSessionId`, `getWatchPaths`) live alongside
> the comprehensive test suite in `test/coverage-suite.js`.

## Prerequisites

- VS Code with the Agent Session Router extension installed (or F5 dev host)
- At least one past Copilot Chat or DeepSeek session in VS Code storage
- Agent Sessions archive repo at `~/Projects/Agent Sessions/` (or custom output dir)

## Procedure

### 1. Launch the Extension Development Host

```bash
# Open the agent-session-router repo in VS Code
code .

# Press F5 to launch the Extension Development Host
```

Or install the `.vsix` and use your normal VS Code window.

### 2. Start the Watcher

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **Agent Session Router: Auto-Export — Monitor for New Sessions**
3. Verify the notification: `Watching N directories (chokidar).`

- [ ] Notification shows the correct directory count
- [ ] No error messages appear

### 3. Trigger a New Session

1. Open Copilot Chat (`Ctrl+Shift+I`)
2. Start a brief coding session — ask a simple question like "What does git status do?"
3. Wait for the response to complete

### 4. Verify Auto-Export

After the session completes + debounce window (5s default):

1. Open the Output panel (`View` → `Output`)
2. Select **Agent Session Router** from the dropdown
3. Verify the channel shows `[watcher]` events:
   - `[watcher] change` or `[watcher] create` for the new session file
   - `[extract]` extraction started/completed
   - `[write]` file written to output directory
4. Check the output directory for the new `.md` file
5. Verify the Markdown file contains the conversation you just had

- [ ] Output channel shows watcher events with correct file paths
- [ ] Markdown file appears in the output directory
- [ ] Markdown content matches the conversation
- [ ] No false positives (non-session files are NOT exported)
- [ ] `awaitWriteFinish` prevents partial-write exports (no truncated files)

### 5. Stop the Watcher

1. Run **Agent Session Router: Auto-Export — Stop Monitoring**
2. Verify the notification: `Watcher stopped`
3. Check the Output channel shows `[watcher] stop`

- [ ] Watcher stops cleanly
- [ ] No zombie timers or file handles remain

### 6. Restart the Watcher

1. Run **Agent Session Router: Auto-Export — Monitor for New Sessions** again
2. Verify it starts successfully

- [ ] Watcher survives deactivation/reactivation cycle

### 7. Edge Cases

| Scenario | Expected Behavior |
|---|---|
| Start watcher with no watchable dirs | Warning: "No watchable directories found" |
| Start watcher twice | Info: "Watcher is already running" |
| Stop watcher when not running | Info: "No watcher running" |
| Non-session file modified in watched dir | Ignored (no export) |
| Large session file mid-write | `awaitWriteFinish` waits for write to complete |
| chokidar not installed | Falls back to VS Code FileSystemWatcher with message |

- [ ] All edge cases behave as documented

## Sign-Off

| Date | Tester | Result | Notes |
|------|--------|--------|-------|
|      |        | ⬜ Pass / ⬜ Fail |       |
