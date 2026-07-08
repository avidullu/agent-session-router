/**
 * Filesystem watcher for auto-export.
 *
 * Uses chokidar (or VS Code's FileSystemWatcher) to monitor agent session
 * directories for new or modified files, triggering automatic export after
 * a configurable debounce period.
 *
 * Status: PLACEHOLDER — full implementation in Phase 3.
 */

import * as vscode from 'vscode';
import { getConfig } from './config';
import { exportSession } from './router';
import { fileStat } from './utils';

export function createWatcher(): vscode.Disposable {
    const config = getConfig();
    const disposables: vscode.Disposable[] = [];

    // TODO: Phase 3 — use chokidar for cross-platform filesystem watching
    // For now, use VS Code's built-in FileSystemWatcher as a basic approach

    // Use VS Code's workspace FileSystemWatcher with null base (monitors all workspaces)
    const deepseekPattern = new vscode.RelativePattern(
        vscode.workspace.workspaceFolders?.[0] || vscode.Uri.file(process.env.USERPROFILE || '~'),
        '**/globalStorage/vizards.deepseek-v4-for-copilot/request-dumps/**/*.json',
    );
    const copilotPattern = new vscode.RelativePattern(
        vscode.workspace.workspaceFolders?.[0] || vscode.Uri.file(process.env.USERPROFILE || '~'),
        '**/workspaceStorage/*/GitHub.copilot-chat/debug-logs/**/main.jsonl',
    );
    const patterns = [deepseekPattern, copilotPattern];

    for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        watcher.onDidChange(async (uri) => {
            console.log(`[agent-session-router] File changed: ${uri.fsPath}`);
            await handleFileEvent(uri.fsPath);
        });

        watcher.onDidCreate(async (uri) => {
            console.log(`[agent-session-router] File created: ${uri.fsPath}`);
            await handleFileEvent(uri.fsPath);
        });

        disposables.push(watcher);
    }

    return vscode.Disposable.from(...disposables);
}

const debounceTimers = new Map<string, NodeJS.Timeout>();

async function handleFileEvent(filePath: string): Promise<void> {
    const config = getConfig();

    // Clear existing debounce timer for this file
    const existing = debounceTimers.get(filePath);
    if (existing) {
        clearTimeout(existing);
    }

    // Set new debounce timer
    const timer = setTimeout(async () => {
        debounceTimers.delete(filePath);
        try {
            const stat = fileStat(filePath);
            // Basic heuristic to determine source kind from path
            const sourceKind = filePath.includes('deepseek') ? 'deepseek_request_dump' : 'copilot_chat';
            const sourceName = filePath.includes('deepseek') ? 'deepseek-vscode-auto' : 'copilot-vscode-auto';

            await exportSession(
                {
                    sourceName,
                    sourceKind,
                    filePath,
                    sessionId: filePath,
                    sizeBytes: stat.size,
                    mtimeMs: stat.mtimeMs,
                },
                config.outputDir || '',
            );
        } catch (err) {
            console.error(`[agent-session-router] Auto-export failed for ${filePath}:`, err);
        }
    }, config.watch.debounceMs);

    debounceTimers.set(filePath, timer);
}
