/**
 * Copilot Chat session discoverer.
 *
 * Scans VS Code workspaceStorage for Copilot Chat transcripts.
 * Primary source: transcripts/{uuid}.jsonl — structured conversation transcript.
 * Fallback: debug-logs/{uuid}/main.jsonl — basic session timeline.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';
import { listCopilotStoreSessions } from '../copilot-session-store';

const COPILOT_EXTENSION_ID = 'github.copilot-chat';

function getWorkspaceStorageRoots(): string[] {
    const roots: string[] = [];

    const appData = process.env.APPDATA;
    if (appData) {
        roots.push(path.join(appData, 'Code', 'User', 'workspaceStorage'));
    }

    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    roots.push(path.join(configDir, 'Code', 'User', 'workspaceStorage'));

    roots.push(
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'workspaceStorage',
        ),
    );

    return roots;
}

function getGlobalStorageRoots(): string[] {
    const roots: string[] = [];
    const appData = process.env.APPDATA;
    if (appData) roots.push(path.join(appData, 'Code', 'User', 'globalStorage'));

    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    roots.push(path.join(configDir, 'Code', 'User', 'globalStorage'));
    roots.push(path.join(os.homedir(), '.vscode-server', 'data', 'User', 'globalStorage'));
    roots.push(path.join(os.homedir(), '.vscode-server-insiders', 'data', 'User', 'globalStorage'));
    roots.push(
        path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage'),
    );

    // A Remote-WSL extension host can see both its Linux store and the Windows
    // VS Code store. Include existing Windows profiles so one router instance
    // can keep both sides of a Surface-style setup current.
    const windowsUsersRoot = '/mnt/c/Users';
    if (os.release().toLowerCase().includes('microsoft') && fs.existsSync(windowsUsersRoot)) {
        try {
            for (const entry of fs.readdirSync(windowsUsersRoot, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                roots.push(
                    path.join(
                        windowsUsersRoot,
                        entry.name,
                        'AppData',
                        'Roaming',
                        'Code',
                        'User',
                        'globalStorage',
                    ),
                );
            }
        } catch {
            // Mounted Windows profiles are optional; native WSL roots still work.
        }
    }

    return Array.from(new Set(roots));
}

async function* discoverCopilotChatSessions(): AsyncIterable<DiscoveredSession> {
    const sqliteSessionIds = new Set<string>();

    for (const storageRoot of getGlobalStorageRoots()) {
        const storePath = path.join(storageRoot, COPILOT_EXTENSION_ID, 'session-store.db');
        if (!fs.existsSync(storePath)) continue;

        const stat = fs.statSync(storePath);
        let sessions;
        try {
            sessions = listCopilotStoreSessions(storePath);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[agent-session-router] Cannot read ${storePath}: ${message}`);
            continue;
        }

        for (const session of sessions) {
            if (session.messageCount === 0) continue;
            sqliteSessionIds.add(session.sessionId);
            yield {
                sourceName: 'copilot-vscode',
                sourceKind: 'copilot_chat',
                filePath: storePath,
                sessionId: session.sessionId,
                sizeBytes: stat.size,
                mtimeMs: stat.mtimeMs,
                sourceRevision: session.revision,
            };
        }
    }

    for (const wsRoot of getWorkspaceStorageRoots()) {
        if (!fs.existsSync(wsRoot)) continue;

        const wsDirs = fs.readdirSync(wsRoot, { withFileTypes: true });
        for (const wsDir of wsDirs) {
            if (!wsDir.isDirectory()) continue;

            const copilotDir = path.join(wsRoot, wsDir.name, COPILOT_EXTENSION_ID);
            if (!fs.existsSync(copilotDir)) continue;

            // Primary: transcripts/{uuid}.jsonl (structured conversation)
            const transcriptsDir = path.join(copilotDir, 'transcripts');
            const foundInTranscripts = new Set<string>();

            if (fs.existsSync(transcriptsDir)) {
                const files = fs.readdirSync(transcriptsDir, { withFileTypes: true });
                for (const file of files) {
                    if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;

                    const filePath = path.join(transcriptsDir, file.name);
                    const stat = fs.statSync(filePath);
                    const sessionId = file.name.replace('.jsonl', '');

                    if (sqliteSessionIds.has(sessionId)) continue;

                    foundInTranscripts.add(sessionId);

                    yield {
                        sourceName: 'copilot-vscode',
                        sourceKind: 'copilot_chat',
                        filePath,
                        sessionId,
                        sizeBytes: stat.size,
                        mtimeMs: stat.mtimeMs,
                    };
                }
            }

            // Fallback: debug-logs/{uuid}/ (only sessions not already in transcripts/)
            const debugLogsDir = path.join(copilotDir, 'debug-logs');
            if (fs.existsSync(debugLogsDir)) {
                const sessionDirs = fs.readdirSync(debugLogsDir, { withFileTypes: true });
                for (const sessionDir of sessionDirs) {
                    if (!sessionDir.isDirectory()) continue;
                    if (foundInTranscripts.has(sessionDir.name)) continue;
                    if (sqliteSessionIds.has(sessionDir.name)) continue;

                    const mainJsonl = path.join(debugLogsDir, sessionDir.name, 'main.jsonl');
                    if (!fs.existsSync(mainJsonl)) continue;

                    const stat = fs.statSync(mainJsonl);

                    yield {
                        sourceName: 'copilot-vscode',
                        sourceKind: 'copilot_chat',
                        filePath: mainJsonl,
                        sessionId: sessionDir.name,
                        sizeBytes: stat.size,
                        mtimeMs: stat.mtimeMs,
                    };
                }
            }
        }
    }
}

registerDiscoverer('copilot_chat', () => discoverCopilotChatSessions());
