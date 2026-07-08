/**
 * Agent Session Router — VS Code Extension
 *
 * Routes VS Code AI agent session transcripts as Markdown files
 * for consumption by the Agent Sessions archive pipeline.
 */

import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { getConfig, Config } from './config';

export function activate(context: vscode.ExtensionContext): void {
    const config = getConfig();

    if (!config.enabled) {
        console.log('[agent-session-router] Extension is disabled via configuration.');
        return;
    }

    console.log('[agent-session-router] Activating Agent Session Router...');

    registerCommands(context);

    // Auto-start watcher if configured
    if (config.watch.enabled) {
        vscode.commands.executeCommand('agentSessionRouter.watchStart');
    }

    console.log('[agent-session-router] Activated successfully.');
}

export function deactivate(): void {
    console.log('[agent-session-router] Deactivated.');
}
