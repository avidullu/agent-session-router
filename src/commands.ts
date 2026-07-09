/**
 * VS Code command registrations for the Agent Session Router extension.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    discoverAllSessions,
    exportAllSessions,
    exportSession,
    resetExportCache,
    resolveOutputDir,
} from './router';
import { getConfig } from './config';
import { getOutputChannel } from './logger';
import { createDiagnosticBundle } from './diagnostics';
import { startWatcher, stopWatcher } from './watcher';
import { DiscoveredSession } from './types';

// ── Discovery summary formatter ──────────────────────────────────────

function displayDiscoverySummary(
    channel: vscode.OutputChannel,
    sessions: DiscoveredSession[],
): void {
    // Group by source kind
    const groups = new Map<string, DiscoveredSession[]>();
    for (const s of sessions) {
        const list = groups.get(s.sourceKind) || [];
        list.push(s);
        groups.set(s.sourceKind, list);
    }

    const totalSize = sessions.reduce((sum, s) => sum + s.sizeBytes, 0);
    const kinds = groups.size;

    channel.appendLine('╔══════════════════════════════════════════╗');
    channel.appendLine('║  Agent Session Discovery — Summary        ║');
    channel.appendLine('╚══════════════════════════════════════════╝');
    channel.appendLine('');
    channel.appendLine(`  Total sessions:  ${sessions.length}`);
    channel.appendLine(`  Source kinds:    ${kinds}`);
    channel.appendLine(`  Total data:      ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
    channel.appendLine('');

    // Per-kind summary
    for (const [kind, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const kindSize = list.reduce((sum, s) => sum + s.sizeBytes, 0);
        const timestamps = list.map((s) => s.mtimeMs).sort((a, b) => a - b);
        const oldest = new Date(timestamps[0]).toISOString().slice(0, 10);
        const newest = new Date(timestamps[timestamps.length - 1]).toISOString().slice(0, 10);
        const avgSize = kindSize / list.length;

        channel.appendLine(`  ┌─ ${kind}`);
        channel.appendLine(`  │  Sessions:  ${list.length}`);
        channel.appendLine(
            `  │  Size:      ${(kindSize / 1024 / 1024).toFixed(1)} MB (avg ${(avgSize / 1024).toFixed(0)} KB/session)`,
        );
        channel.appendLine(`  │  Span:      ${oldest} → ${newest}`);
        channel.appendLine(`  │  Source:    ${list[0].sourceName}`);
        channel.appendLine(`  └─ Sample:   ${list[0].filePath}`);
        channel.appendLine('');
    }

    // Recent sessions (last 5 by modification time)
    const recent = [...sessions].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5);
    channel.appendLine('  ── Most Recent Sessions ──');
    for (const s of recent) {
        const when = new Date(s.mtimeMs).toISOString().slice(0, 19).replace('T', ' ');
        channel.appendLine(`  ${when}  [${s.sourceKind}]  ${(s.sizeBytes / 1024).toFixed(0)} KB`);
    }
    channel.appendLine('');
    channel.appendLine('  Run "Export All Sessions" to archive these as Markdown.');
}

// ── Output-directory validation ─────────────────────────────────────

/**
 * Check that a path can be used as an output directory.
 * Returns an error message string if invalid, or `undefined` if OK.
 *
 * Rules:
 *  - Path must exist as a directory (or have a writable parent for new dirs).
 *  - Must be writable (verified by creating + deleting a temp file).
 */
function validateOutputDir(dirPath: string): string | undefined {
    if (!dirPath || !dirPath.trim()) {
        return 'Path cannot be empty.';
    }

    const resolved = path.resolve(dirPath.trim());

    // Normalize away trailing separators so stat calls work reliably
    const normalized = resolved.replace(/[\\/]+$/, '');

    let stat: fs.Stats;
    try {
        stat = fs.statSync(normalized);
    } catch {
        // Path doesn't exist — check that the parent is a writable directory
        const parent = path.dirname(normalized);
        if (parent === normalized) {
            return 'Path is a root drive and cannot be created.';
        }
        try {
            const parentStat = fs.statSync(parent);
            if (!parentStat.isDirectory()) {
                return `Parent path '${parent}' is not a directory.`;
            }
            // Check parent writability
            const probe = path.join(parent, '.agent-session-router-write-test');
            try {
                fs.writeFileSync(probe, 'test', { flag: 'wx' });
                fs.unlinkSync(probe);
            } catch {
                return `Parent directory '${parent}' is not writable.`;
            }
            return undefined; // parent exists and is writable — the dir will be created on first export
        } catch {
            return `Parent directory '${parent}' does not exist. Create it first.`;
        }
    }

    if (!stat.isDirectory()) {
        return `Path '${normalized}' exists but is not a directory.`;
    }

    // Verify write permission by creating + deleting a temp probe file
    const probe = path.join(normalized, '.agent-session-router-write-test');
    try {
        fs.writeFileSync(probe, 'test', { flag: 'wx' });
        fs.unlinkSync(probe);
    } catch {
        return `Directory '${normalized}' is not writable. Check permissions.`;
    }

    return undefined;
}

// ── Command registrations ────────────────────────────────────────────

export function registerCommands(context: vscode.ExtensionContext): void {
    const channel = getOutputChannel();

    // Discover sessions
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.discover', async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Agent Session Router: Discovering sessions...',
                    cancellable: true,
                },
                async (progress) => {
                    const sessions = await discoverAllSessions(progress);
                    if (sessions.length === 0) {
                        vscode.window.showInformationMessage(
                            'Agent Session Router: No agent sessions found.',
                        );
                        return;
                    }

                    // Show results as a useful summary (not a raw dump)
                    channel.clear();
                    displayDiscoverySummary(channel, sessions);
                    channel.show();

                    const kinds = [...new Set(sessions.map((s) => s.sourceKind))].join(', ');
                    const totalSize = sessions.reduce((sum, s) => sum + s.sizeBytes, 0);
                    vscode.window.showInformationMessage(
                        `Agent Session Router: ${sessions.length} sessions across ${kinds} (${(totalSize / 1024 / 1024).toFixed(1)} MB). See output for details.`,
                    );
                },
            );
        }),
    );

    // Export all sessions
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.exportAll', async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Agent Session Router: Exporting sessions...',
                    cancellable: true,
                },
                async (progress) => {
                    const records = await exportAllSessions(progress);

                    if (records.length === 0) {
                        vscode.window.showInformationMessage(
                            'Agent Session Router: No sessions exported.',
                        );
                        return;
                    }

                    channel.clear();
                    channel.appendLine(`Exported ${records.length} sessions:\n`);
                    for (const r of records) {
                        channel.appendLine(`  ✅ ${r.markdownPath}`);
                    }
                    channel.show();

                    vscode.window.showInformationMessage(
                        `Agent Session Router: Exported ${records.length} sessions to Markdown.`,
                    );
                },
            );
        }),
    );

    // Export selected session
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.exportSession', async () => {
            const config = getConfig();

            // Let user pick a file to export
            const files = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Export Session',
                filters: {
                    'Agent Sessions': ['json', 'jsonl', 'txt'],
                    'All Files': ['*'],
                },
            });

            if (!files || files.length === 0) return;

            // Try to determine the source kind from the file path
            const filePath = files[0].fsPath;
            let sourceKind = 'deepseek_request_dump';
            let sourceName = 'manual-export';

            if (filePath.includes('copilot-chat') || filePath.includes('debug-logs')) {
                sourceKind = 'copilot_chat';
                sourceName = 'copilot-vscode-manual';
            } else if (filePath.includes('deepseek') || filePath.includes('request-dumps')) {
                sourceKind = 'deepseek_request_dump';
                sourceName = 'deepseek-vscode-manual';
            }

            const stat = await vscode.workspace.fs.stat(files[0]);

            const record = await exportSession(
                {
                    sourceName,
                    sourceKind,
                    filePath,
                    sessionId: filePath,
                    sizeBytes: stat.size,
                    mtimeMs: stat.mtime,
                },
                config.outputDir || '',
            );

            if (record) {
                vscode.window.showInformationMessage(
                    `Agent Session Router: Exported to ${record.markdownPath}`,
                );
            } else {
                vscode.window.showWarningMessage(
                    'Agent Session Router: Could not extract session from the selected file.',
                );
            }
        }),
    );

    // Show configuration
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.showConfig', async () => {
            const config = getConfig();
            const resolvedDir = resolveOutputDir(config);
            channel.clear();
            channel.appendLine('╔══════════════════════════════════════════╗');
            channel.appendLine('║  Agent Session Router — Configuration     ║');
            channel.appendLine('╚══════════════════════════════════════════╝');
            channel.appendLine('');
            channel.appendLine(`  Enabled:         ${config.enabled}`);
            channel.appendLine(`  Output dir:      ${config.outputDir || '(auto-detect)'}`);
            channel.appendLine(`  Resolved dir:    ${resolvedDir}`);
            channel.appendLine(`  Max session age: ${config.maxSessionAge || '(no limit)'}`);
            channel.appendLine(`  Watch enabled:   ${config.watch.enabled}`);
            channel.appendLine(`  Watch debounce:  ${config.watch.debounceMs}ms`);
            channel.appendLine('');
            channel.appendLine('  ── Sources ──');
            for (const [kind, src] of Object.entries(config.sources)) {
                channel.appendLine(`  ${src.enabled ? '✅' : '❌'} ${kind}`);
            }
            channel.appendLine('');
            channel.appendLine('  ── Actions ──');
            channel.appendLine('  • Run "Set Output Directory" to change where files are saved');
            channel.appendLine('  • Edit settings.json to adjust sources, watch, or age');
            channel.appendLine('');
            channel.appendLine('  Raw config:');
            channel.appendLine(JSON.stringify(config, null, 2));
            channel.show();
        }),
    );

    // Set output directory
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.setOutputDir', async () => {
            const config = getConfig();
            const currentDir = config.outputDir || resolveOutputDir(config);

            // Ask user how they want to set the directory
            const choice = await vscode.window.showQuickPick(
                [
                    {
                        label: '📁 Choose a folder...',
                        description: 'Browse to select the output directory',
                        detail: `Current: ${currentDir}`,
                        action: 'browse' as const,
                    },
                    {
                        label: '📋 Type a path...',
                        description: 'Manually enter a directory path',
                        detail: `Current: ${currentDir}`,
                        action: 'type' as const,
                    },
                    {
                        label: '🔄 Reset to auto-detect',
                        description: 'Clear the setting and use the default location',
                        detail: 'The extension will find your Agent Sessions archive automatically',
                        action: 'reset' as const,
                    },
                ],
                {
                    placeHolder: 'How would you like to set the output directory?',
                    title: 'Agent Session Router — Set Output Directory',
                },
            );

            if (!choice) return;

            let newDir: string | undefined;

            if (choice.action === 'browse') {
                const folders = await vscode.window.showOpenDialog({
                    canSelectFiles: false,
                    canSelectFolders: true,
                    canSelectMany: false,
                    openLabel: 'Select Output Directory',
                    title: 'Agent Session Router — Choose where to save exported sessions',
                });
                if (!folders || folders.length === 0) return;
                newDir = folders[0].fsPath;

                // Validate the browsed folder is writable
                const browseError = validateOutputDir(newDir);
                if (browseError) {
                    vscode.window.showErrorMessage(
                        `Agent Session Router: Cannot use this folder. ${browseError}`,
                    );
                    return;
                }
            } else if (choice.action === 'type') {
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter the path for the output directory',
                    value: currentDir,
                    placeHolder: 'e.g. C:\\Users\\You\\Projects\\Agent Sessions\\archive',
                    validateInput: (value) => {
                        return validateOutputDir(value);
                    },
                });
                if (!input) return;
                newDir = input.trim();
            } else if (choice.action === 'reset') {
                newDir = '';
            }

            if (newDir === undefined) return;

            // Final safety check (should never fail after validation, but belt + suspenders)
            if (newDir) {
                const finalError = validateOutputDir(newDir);
                if (finalError) {
                    vscode.window.showErrorMessage(
                        `Agent Session Router: Cannot save setting. ${finalError}`,
                    );
                    return;
                }
            }

            // Update the VS Code setting
            const target = vscode.ConfigurationTarget.Global;
            const cfg = vscode.workspace.getConfiguration('agentSessionRouter');
            await cfg.update('outputDir', newDir, target);

            // Confirm
            const displayDir = newDir || resolveOutputDir(getConfig());
            channel.clear();
            channel.appendLine('╔══════════════════════════════════════════╗');
            channel.appendLine('║  Output Directory Updated                 ║');
            channel.appendLine('╚══════════════════════════════════════════╝');
            channel.appendLine('');
            if (newDir) {
                channel.appendLine(`  New directory:  ${path.resolve(newDir)}`);
            } else {
                channel.appendLine(`  Setting cleared — using auto-detect`);
                channel.appendLine(`  Resolved dir:   ${displayDir}`);
            }
            channel.appendLine('');
            channel.appendLine('  Run "Export All Sessions" to start exporting.');
            channel.show();

            vscode.window.showInformationMessage(
                newDir
                    ? `Agent Session Router: Output directory set to ${path.resolve(newDir)}`
                    : 'Agent Session Router: Output directory reset to auto-detect.',
            );
        }),
    );

    // Export diagnostic bundle
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.diagnosticBundle', async () => {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Agent Session Router: Creating diagnostic bundle...',
                    cancellable: false,
                },
                async (_progress) => {
                    try {
                        const bundle = await createDiagnosticBundle();
                        channel.clear();
                        channel.appendLine('Diagnostic Bundle Created');
                        channel.appendLine('═══════════════════════════');
                        channel.appendLine(`Location: ${bundle.zipPath}`);
                        channel.appendLine(
                            `Diagnostics entries: ${bundle.summary.diagnosticsLines}`,
                        );
                        channel.appendLine(`Source samples: ${bundle.summary.sourceSamples}`);
                        channel.appendLine(`Config included: ${bundle.summary.configIncluded}`);
                        channel.appendLine(
                            `Total size: ${(bundle.summary.totalSizeBytes / 1024).toFixed(1)} KB`,
                        );
                        channel.appendLine('');
                        channel.appendLine(
                            'Share this folder with your AI agent or attach to a GitHub issue:',
                        );
                        channel.appendLine(`  ${bundle.zipPath}`);
                        channel.appendLine('');
                        channel.appendLine('To inspect errors:');
                        channel.appendLine(
                            `  cat "${bundle.zipPath}/diagnostics.jsonl" | jq 'select(.level=="error")'`,
                        );
                        channel.show();

                        // Offer to reveal in file explorer
                        const action = await vscode.window.showInformationMessage(
                            `Diagnostic bundle created (${(bundle.summary.totalSizeBytes / 1024).toFixed(1)} KB). Reveal in Explorer?`,
                            'Reveal',
                            'Copy Path',
                        );
                        if (action === 'Reveal') {
                            vscode.commands.executeCommand(
                                'revealFileInOS',
                                vscode.Uri.file(bundle.zipPath),
                            );
                        } else if (action === 'Copy Path') {
                            vscode.env.clipboard.writeText(bundle.zipPath);
                        }
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        channel.appendLine(`ERROR creating diagnostic bundle: ${error.message}`);
                        channel.show();
                        vscode.window.showErrorMessage(
                            `Agent Session Router: Failed to create diagnostic bundle. ${error.message}`,
                        );
                    }
                },
            );
        }),
    );

    // Start watcher
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.watchStart', async () => {
            await startWatcher();
        }),
    );

    // Stop watcher
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.watchStop', async () => {
            await stopWatcher();
        }),
    );

    // Reset in-memory export cache
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.resetState', async () => {
            resetExportCache();
            channel.appendLine('Export cache cleared. Next export will re-process all sessions.');
            channel.show();
            vscode.window.showInformationMessage(
                'Agent Session Router: State reset. All cached exports cleared.',
            );
        }),
    );
}
