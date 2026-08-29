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
import { inspectVSCodeChatSession } from '../vscode-chat-session';
import { getConfig } from '../config';
import { getWindowsProfileRoots } from '../windows-profile-roots';

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

    for (const profileRoot of getWindowsProfileRoots(getConfig().windowsProfileRoots)) {
        roots.push(
            path.join(profileRoot, 'AppData', 'Roaming', 'Code', 'User', 'workspaceStorage'),
        );
    }

    return Array.from(new Set(roots));
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

    // A Remote-WSL extension host may include the current or explicitly
    // allowlisted Windows profiles; it never enumerates every local account.
    for (const profileRoot of getWindowsProfileRoots(getConfig().windowsProfileRoots)) {
        roots.push(path.join(profileRoot, 'AppData', 'Roaming', 'Code', 'User', 'globalStorage'));
    }

    return Array.from(new Set(roots));
}

export function collectNativeChatSessions(
    workspaceRoots: string[],
    excludedSessionIds: ReadonlySet<string>,
): DiscoveredSession[] {
    const newestBySession = new Map<string, DiscoveredSession>();
    for (const wsRoot of workspaceRoots) {
        if (!fs.existsSync(wsRoot)) continue;
        const wsDirs = fs.readdirSync(wsRoot, { withFileTypes: true });
        for (const wsDir of wsDirs) {
            if (!wsDir.isDirectory()) continue;
            const nativeChatDir = path.join(wsRoot, wsDir.name, 'chatSessions');
            if (!fs.existsSync(nativeChatDir)) continue;

            const files = fs.readdirSync(nativeChatDir, { withFileTypes: true });
            for (const file of files) {
                if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
                const filePath = path.join(nativeChatDir, file.name);
                let summary;
                try {
                    summary = inspectVSCodeChatSession(filePath);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`[agent-session-router] Cannot read ${filePath}: ${message}`);
                    continue;
                }
                if (summary.messageCount === 0) continue;
                const provider = summary.modelProvider?.replace(/[^a-z0-9-]/g, '');
                if (
                    (!provider || provider === 'copilot') &&
                    excludedSessionIds.has(summary.sessionId)
                ) {
                    continue;
                }

                const stat = fs.statSync(filePath);
                const candidate: DiscoveredSession = {
                    sourceName:
                        provider && provider !== 'copilot'
                            ? `${provider}-vscode`
                            : 'copilot-vscode',
                    sourceKind: 'copilot_chat',
                    filePath,
                    sessionId: summary.sessionId,
                    sizeBytes: stat.size,
                    mtimeMs: stat.mtimeMs,
                    sourceRevision: summary.revision,
                };
                const previous = newestBySession.get(summary.sessionId);
                if (!previous || candidate.mtimeMs > previous.mtimeMs) {
                    newestBySession.set(summary.sessionId, candidate);
                }
            }
        }
    }
    return Array.from(newestBySession.values()).sort((a, b) =>
        a.sessionId.localeCompare(b.sessionId),
    );
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

    const workspaceRoots = getWorkspaceStorageRoots();
    for (const session of collectNativeChatSessions(workspaceRoots, sqliteSessionIds)) {
        yield session;
    }

    for (const wsRoot of workspaceRoots) {
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
