/**
 * VS Code command registrations for the Agent Session Router extension.
 */

import * as vscode from 'vscode';
import { discoverAllSessions, exportAllSessions, exportSession } from './router';
import { getConfig } from './config';

export function registerCommands(context: vscode.ExtensionContext): void {
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
                            'Agent Session Router: No agent sessions found.'
                        );
                        return;
                    }

                    // Show results in output channel
                    const output = vscode.window.createOutputChannel('Agent Session Router');
                    output.clear();
                    output.appendLine(`Discovered ${sessions.length} agent sessions:\n`);
                    for (const s of sessions) {
                        output.appendLine(`  [${s.sourceKind}] ${s.sourceName}`);
                        output.appendLine(`    Session: ${s.sessionId}`);
                        output.appendLine(`    File: ${s.filePath}`);
                        output.appendLine(`    Size: ${(s.sizeBytes / 1024).toFixed(1)} KB`);
                        output.appendLine(`    Modified: ${new Date(s.mtimeMs).toISOString()}`);
                        output.appendLine('');
                    }
                    output.show();

                    vscode.window.showInformationMessage(
                        `Agent Session Router: Discovered ${sessions.length} sessions. See output panel for details.`
                    );
                }
            );
        })
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
                            'Agent Session Router: No sessions exported.'
                        );
                        return;
                    }

                    const output = vscode.window.createOutputChannel('Agent Session Router');
                    output.clear();
                    output.appendLine(`Exported ${records.length} sessions:\n`);
                    for (const r of records) {
                        output.appendLine(`  ✅ ${r.markdownPath}`);
                    }
                    output.show();

                    vscode.window.showInformationMessage(
                        `Agent Session Router: Exported ${records.length} sessions to Markdown.`
                    );
                }
            );
        })
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
                    `Agent Session Router: Exported to ${record.markdownPath}`
                );
            } else {
                vscode.window.showWarningMessage(
                    'Agent Session Router: Could not extract session from the selected file.'
                );
            }
        })
    );

    // Show configuration
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.showConfig', async () => {
            const config = getConfig();
            const output = vscode.window.createOutputChannel('Agent Session Router');
            output.clear();
            output.appendLine('Current Configuration:');
            output.appendLine(JSON.stringify(config, null, 2));
            output.show();
        })
    );

    // Start watcher
    let watcherDisposable: vscode.Disposable | undefined;
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.watchStart', async () => {
            if (watcherDisposable) {
                vscode.window.showInformationMessage('Agent Session Router: Watcher is already running.');
                return;
            }
            // Placeholder — watcher implementation in watcher.ts
            vscode.window.showInformationMessage(
                'Agent Session Router: Watcher started (placeholder). Full watcher implementation pending.'
            );
            watcherDisposable = new vscode.Disposable(() => {
                console.log('[agent-session-router] Watcher stopped.');
            });
        })
    );

    // Stop watcher
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.watchStop', async () => {
            if (watcherDisposable) {
                watcherDisposable.dispose();
                watcherDisposable = undefined;
                vscode.window.showInformationMessage('Agent Session Router: Watcher stopped.');
            } else {
                vscode.window.showInformationMessage('Agent Session Router: No watcher is running.');
            }
        })
    );
}
