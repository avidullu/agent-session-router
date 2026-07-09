/**
 * Agent Session Router — VS Code Extension
 *
 * Routes VS Code AI agent session transcripts as Markdown files
 * for consumption by the Agent Sessions archive pipeline.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { registerCommands } from './commands';
import { getConfig } from './config';
import { initLogger, getOutputChannel, getDiagnosticsPath } from './logger';

export function activate(context: vscode.ExtensionContext): void {
    const config = getConfig();

    // Initialize structured logger early
    const outputDir =
        config.outputDir || path.join(os.homedir(), 'Projects', 'Agent Sessions', 'archive');
    initLogger(outputDir);

    const channel = getOutputChannel();
    channel.appendLine('═══════════════════════════════════════════');
    channel.appendLine('Agent Session Router v0.1.0');
    channel.appendLine(`Activated at: ${new Date().toISOString()}`);
    channel.appendLine('═══════════════════════════════════════════');

    if (!config.enabled) {
        channel.appendLine('Extension is disabled via configuration. Exiting.');
        return;
    }

    channel.appendLine('Registering commands...');
    registerCommands(context);

    // Auto-start watcher if configured
    if (config.watch.enabled) {
        channel.appendLine('Auto-starting watcher...');
        vscode.commands.executeCommand('agentSessionRouter.watchStart');
    }

    channel.appendLine('Agent Session Router activated successfully.');
    channel.appendLine(`Diagnostics: ${getDiagnosticsPath() || 'N/A'}`);
}

export function deactivate(): void {
    console.log('[agent-session-router] Deactivated.');
}
