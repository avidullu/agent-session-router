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
