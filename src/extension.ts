/**
 * Agent Session Router — VS Code Extension
 *
 * Routes VS Code AI agent session transcripts as Markdown files
 * for consumption by the Agent Sessions archive pipeline.
 */

import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { getConfig } from './config';
import { initLogger, getOutputChannel, getDiagnosticsPath } from './logger';
import { resolveOutputDir } from './router';
import { isWatcherRunning, stopWatcher, syncWatcher } from './watcher';

export function activate(context: vscode.ExtensionContext): void {
    // Invalid synced paths must not prevent the repair commands from registering.
    const configureLogging = (): void => {
        try {
            initLogger(resolveOutputDir(getConfig()));
        } catch (err) {
            initLogger(context.logUri.fsPath);
            const message = err instanceof Error ? err.message : String(err);
            getOutputChannel().appendLine(message);
            void vscode.window
                .showWarningMessage(`Agent Session Router: ${message}`, 'Set Output Directory')
                .then((choice) => {
                    if (choice)
                        void vscode.commands.executeCommand('agentSessionRouter.setOutputDir');
                });
        }
    };
    configureLogging();

    const channel = getOutputChannel();
    channel.appendLine('═══════════════════════════════════════════');
    channel.appendLine(`Agent Session Router v${context.extension.packageJSON.version}`);
    channel.appendLine(`Activated at: ${new Date().toISOString()}`);
    channel.appendLine('═══════════════════════════════════════════');

    channel.appendLine('Registering commands...');
    registerCommands(context);

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration('agentSessionRouter')) return;
            if (event.affectsConfiguration('agentSessionRouter.outputDir')) configureLogging();
            void syncWatcher();
        }),
    );
    void syncWatcher();
    const config = getConfig();
    channel.appendLine(
        !config.enabled
            ? 'Extension disabled. Auto-export is stopped.'
            : config.watch.enabled
              ? 'Starting auto-export watcher...'
              : 'Auto-export is off. Run "Auto-Export — Monitor for New Sessions" to enable it.',
    );

    channel.appendLine('Agent Session Router activated successfully.');
    channel.appendLine(`Diagnostics: ${getDiagnosticsPath() || 'N/A'}`);
}

export async function deactivate(): Promise<void> {
    await syncWatcher();
    if (isWatcherRunning()) await stopWatcher();
    console.log('[agent-session-router] Deactivated.');
}
