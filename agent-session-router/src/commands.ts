/**
 * VS Code command registrations for the Agent Session Router extension.
 */

import * as vscode from 'vscode';
import { discoverAllSessions, exportAllSessions, exportSession } from './router';
import { getConfig } from './config';
import { getOutputChannel } from './logger';
import { createDiagnosticBundle } from './diagnostics';
import { startWatcher, stopWatcher } from './watcher';

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
                            'Agent Session Router: No agent sessions found.'
                        );
                        return;
                    }

                    // Show results in output channel
                    channel.clear();
                    channel.appendLine(`Discovered ${sessions.length} agent sessions:\n`);
                    for (const s of sessions) {
                        channel.appendLine(`  [${s.sourceKind}] ${s.sourceName}`);
                        channel.appendLine(`    Session: ${s.sessionId}`);
                        channel.appendLine(`    File: ${s.filePath}`);
                        channel.appendLine(`    Size: ${(s.sizeBytes / 1024).toFixed(1)} KB`);
                        channel.appendLine(`    Modified: ${new Date(s.mtimeMs).toISOString()}`);
                        channel.appendLine('');
                    }
                    channel.show();

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

                    channel.clear();
                    channel.appendLine(`Exported ${records.length} sessions:\n`);
                    for (const r of records) {
                        channel.appendLine(`  ✅ ${r.markdownPath}`);
                    }
                    channel.show();

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
            channel.clear();
            channel.appendLine('Current Configuration:');
            channel.appendLine(JSON.stringify(config, null, 2));
            channel.show();
        })
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
                        channel.appendLine(`Diagnostics entries: ${bundle.summary.diagnosticsLines}`);
                        channel.appendLine(`Source samples: ${bundle.summary.sourceSamples}`);
                        channel.appendLine(`Config included: ${bundle.summary.configIncluded}`);
                        channel.appendLine(`Total size: ${(bundle.summary.totalSizeBytes / 1024).toFixed(1)} KB`);
                        channel.appendLine('');
                        channel.appendLine('Share this folder with your AI agent or attach to a GitHub issue:');
                        channel.appendLine(`  ${bundle.zipPath}`);
                        channel.appendLine('');
                        channel.appendLine('To inspect errors:');
                        channel.appendLine(`  cat "${bundle.zipPath}/diagnostics.jsonl" | jq 'select(.level=="error")'`);
                        channel.show();

                        // Offer to reveal in file explorer
                        const action = await vscode.window.showInformationMessage(
                            `Diagnostic bundle created (${(bundle.summary.totalSizeBytes / 1024).toFixed(1)} KB). Reveal in Explorer?`,
                            'Reveal',
                            'Copy Path',
                        );
                        if (action === 'Reveal') {
                            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(bundle.zipPath));
                        } else if (action === 'Copy Path') {
                            vscode.env.clipboard.writeText(bundle.zipPath);
                        }
                    } catch (err) {
                        const error = err instanceof Error ? err : new Error(String(err));
                        channel.appendLine(`ERROR creating diagnostic bundle: ${error.message}`);
                        channel.show();
                        vscode.window.showErrorMessage(
                            `Agent Session Router: Failed to create diagnostic bundle. ${error.message}`
                        );
                    }
                }
            );
        })
    );

    // Start watcher
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.watchStart', async () => {
            await startWatcher();
        })
    );

    // Stop watcher
    context.subscriptions.push(
        vscode.commands.registerCommand('agentSessionRouter.watchStop', async () => {
            await stopWatcher();
        })
    );
}
