/**
 * Copilot Chat session discoverer.
 *
 * Scans VS Code workspaceStorage for Copilot Chat debug-logs and
 * chat-session-resources directories.
 *
 * Each debug-logs subdirectory (named by UUID) is a session.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

const COPILOT_EXTENSION_ID = 'github.copilot-chat';

function getWorkspaceStorageRoots(): string[] {
    const roots: string[] = [];

    const appData = process.env.APPDATA;
    if (appData) {
        roots.push(path.join(appData, 'Code', 'User', 'workspaceStorage'));
    }

    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    roots.push(path.join(configDir, 'Code', 'User', 'workspaceStorage'));

    roots.push(path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'workspaceStorage'));

    return roots;
}

async function* discoverCopilotChatSessions(): AsyncIterable<DiscoveredSession> {
    for (const wsRoot of getWorkspaceStorageRoots()) {
        if (!fs.existsSync(wsRoot)) continue;

        const wsDirs = fs.readdirSync(wsRoot, { withFileTypes: true });
        for (const wsDir of wsDirs) {
            if (!wsDir.isDirectory()) continue;

            const debugLogsDir = path.join(wsRoot, wsDir.name, COPILOT_EXTENSION_ID, 'debug-logs');
            if (!fs.existsSync(debugLogsDir)) continue;

            const sessionDirs = fs.readdirSync(debugLogsDir, { withFileTypes: true });
            for (const sessionDir of sessionDirs) {
                if (!sessionDir.isDirectory()) continue;

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

registerDiscoverer('copilot_chat', () => discoverCopilotChatSessions());
