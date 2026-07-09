/**
 * Filesystem watcher for auto-export (Phase 3).
 *
 * Uses chokidar for cross-platform filesystem watching with debounce.
 * Monitors VS Code globalStorage and workspaceStorage for new or modified
 * agent session files, triggering automatic export.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { getConfig } from './config';
import { exportSession, resolveOutputDir } from './router';
import { fileStat } from './utils';
import { logWatcherEvent } from './logger';

// ---------------------------------------------------------------------------
// Chokidar dynamic import (falls back to VS Code FileSystemWatcher)
// ---------------------------------------------------------------------------

let chokidar: typeof import('chokidar') | null = null;
let chokidarLoadAttempted = false;

async function ensureChokidar(): Promise<typeof import('chokidar')> {
    if (!chokidar && !chokidarLoadAttempted) {
        chokidarLoadAttempted = true;
        try {
            chokidar = await import('chokidar');
        } catch {
            chokidar = null;
        }
    }
    if (!chokidar) {
        throw new Error(
            "chokidar is not installed. The watcher will use VS Code's built-in " +
                'file watcher as a fallback. For better performance, run: npm install chokidar',
        );
    }
    return chokidar;
}

// ---------------------------------------------------------------------------
// Watcher state
// ---------------------------------------------------------------------------

interface WatcherState {
    watcher: import('chokidar').FSWatcher | null;
    debounceTimers: Map<string, NodeJS.Timeout>;
    isRunning: boolean;
}

const state: WatcherState = {
    watcher: null,
    debounceTimers: new Map(),
    isRunning: false,
};

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getWatchPaths(): string[] {
    const paths: string[] = [];
    const appData = process.env.APPDATA;
    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

    if (appData) {
        paths.push(
            path.join(
                appData,
                'Code',
                'User',
                'globalStorage',
                'vizards.deepseek-v4-for-copilot',
                'request-dumps',
            ),
        );
        paths.push(path.join(appData, 'Code', 'User', 'workspaceStorage'));
    }

    paths.push(path.join(configDir, 'Code', 'User', 'workspaceStorage'));
    paths.push(
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'workspaceStorage',
        ),
    );

    return paths.filter((p) => fs.existsSync(p));
}

// ---------------------------------------------------------------------------
// File event handler
// ---------------------------------------------------------------------------

function isSessionFile(filePath: string): boolean {
    const isDeepSeek = filePath.includes('request-dumps') && filePath.endsWith('.json');
    const isCopilotTranscript = filePath.includes('transcripts') && filePath.endsWith('.jsonl');
    const isCopilotDebugLog = filePath.includes('debug-logs') && filePath.endsWith('main.jsonl');
    return isDeepSeek || isCopilotTranscript || isCopilotDebugLog;
}

function determineSourceKind(filePath: string): string {
    if (filePath.includes('deepseek') || filePath.includes('request-dumps')) {
        return 'deepseek_request_dump';
    }
    return 'copilot_chat';
}

function determineSourceName(filePath: string): string {
    if (filePath.includes('deepseek') || filePath.includes('request-dumps')) {
        return 'deepseek-vscode-auto';
    }
    return 'copilot-vscode-auto';
}

function extractSessionId(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[i])) {
            return parts[i];
        }
    }
    return path.basename(filePath, path.extname(filePath));
}

async function handleFileEvent(filePath: string, event: 'change' | 'create'): Promise<void> {
    if (!isSessionFile(filePath)) return;

    const config = getConfig();
    const existing = state.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
        state.debounceTimers.delete(filePath);
        try {
            const stat = fileStat(filePath);
            const sourceKind = determineSourceKind(filePath);
            const sourceName = determineSourceName(filePath);
            const sessionId = extractSessionId(filePath);

            logWatcherEvent(event, filePath, { sourceKind, sessionId, sizeBytes: stat.size });

            await exportSession(
                {
                    sourceName,
                    sourceKind,
                    filePath,
                    sessionId,
                    sizeBytes: stat.size,
                    mtimeMs: stat.mtimeMs,
                },
                resolveOutputDir(config),
            );
        } catch (err) {
            logWatcherEvent('error', filePath, {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }, config.watch.debounceMs);

    state.debounceTimers.set(filePath, timer);
}

// ---------------------------------------------------------------------------
// Start / Stop
// ---------------------------------------------------------------------------

export async function startWatcher(): Promise<void> {
    if (state.isRunning) {
        vscode.window.showInformationMessage('Agent Session Router: Watcher is already running.');
        return;
    }

    const watchPaths = getWatchPaths();
    if (watchPaths.length === 0) {
        vscode.window.showWarningMessage('Agent Session Router: No watchable directories found.');
        return;
    }

    logWatcherEvent('start');

    // Try chokidar first; fall back to VS Code's built-in watcher
    let chokidarLib: typeof import('chokidar') | null = null;
    try {
        chokidarLib = await ensureChokidar();
    } catch {
        // Fall through to VS Code fallback
    }

    if (chokidarLib) {
        // ── Chokidar path (full-featured) ──
        state.watcher = chokidarLib.watch(watchPaths, {
            ignored: [/(^|[\\/])\.\./, /node_modules/, /\.git/, '**/models.json'],
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
            depth: 10,
        }) as any;

        state.watcher!.on('add', (fp: string) => handleFileEvent(fp, 'create'));
        state.watcher!.on('change', (fp: string) => handleFileEvent(fp, 'change'));
        state.watcher!.on('error', (error: Error) => {
            logWatcherEvent('error', undefined, { error: error.message });
        });

        vscode.window.showInformationMessage(
            `Agent Session Router: Watching ${watchPaths.length} directories (chokidar).`,
        );
    } else {
        // ── VS Code FileSystemWatcher fallback ──
        const disposables: vscode.Disposable[] = [];
        for (const watchPath of watchPaths) {
            const pattern = new vscode.RelativePattern(vscode.Uri.file(watchPath), '**/*');
            const fsw = vscode.workspace.createFileSystemWatcher(pattern);
            fsw.onDidCreate((uri) => handleFileEvent(uri.fsPath, 'create'));
            fsw.onDidChange((uri) => handleFileEvent(uri.fsPath, 'change'));
            disposables.push(fsw);
        }

        // Wrap disposable array as a pseudo-watcher
        state.watcher = {
            close: async () => {
                for (const d of disposables) d.dispose();
            },
        } as any;

        vscode.window.showInformationMessage(
            `Agent Session Router: Watching ${watchPaths.length} directories (VS Code fallback). ` +
                'Install chokidar for better performance.',
        );
    }

    state.isRunning = true;
}

export async function stopWatcher(): Promise<void> {
    if (!state.isRunning || !state.watcher) {
        vscode.window.showInformationMessage('Agent Session Router: No watcher running.');
        return;
    }

    logWatcherEvent('stop');
    for (const timer of state.debounceTimers.values()) clearTimeout(timer);
    state.debounceTimers.clear();
    await state.watcher.close();
    state.watcher = null;
    state.isRunning = false;

    vscode.window.showInformationMessage('Agent Session Router: Watcher stopped.');
}

export function isWatcherRunning(): boolean {
    return state.isRunning;
}
