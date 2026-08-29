/** Build cache-compatible session identities for the manual export command. */

import * as path from 'path';
import { listCopilotStoreSessions } from './copilot-session-store';
import { DiscoveredSession } from './types';
import { inspectVSCodeChatSession } from './vscode-chat-session';

export interface ManualSessionCandidate {
    session: DiscoveredSession;
    messageCount?: number;
}

function providerSourceName(provider: string | undefined): string {
    const safeProvider = provider?.toLowerCase().replace(/[^a-z0-9-]/g, '');
    return safeProvider && safeProvider !== 'copilot'
        ? `${safeProvider}-vscode`
        : 'copilot-vscode';
}

function sessionIdFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split('/');
    for (let index = parts.length - 1; index >= 0; index--) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[index])) {
            return parts[index];
        }
    }
    return path.basename(normalized, path.extname(normalized));
}

export function manualSessionCandidates(
    filePath: string,
    sizeBytes: number,
    mtimeMs: number,
): ManualSessionCandidate[] {
    if (path.basename(filePath) === 'session-store.db') {
        return listCopilotStoreSessions(filePath)
            .filter((summary) => summary.messageCount > 0)
            .map((summary) => ({
                messageCount: summary.messageCount,
                session: {
                    sourceName: 'copilot-vscode',
                    sourceKind: 'copilot_chat',
                    filePath,
                    sessionId: summary.sessionId,
                    sizeBytes,
                    mtimeMs,
                    sourceRevision: summary.revision,
                },
            }));
    }

    if (path.basename(path.dirname(filePath)) === 'chatSessions') {
        const summary = inspectVSCodeChatSession(filePath);
        if (summary.messageCount === 0) return [];
        return [
            {
                messageCount: summary.messageCount,
                session: {
                    sourceName: providerSourceName(summary.modelProvider),
                    sourceKind: 'copilot_chat',
                    filePath,
                    sessionId: summary.sessionId,
                    sizeBytes,
                    mtimeMs,
                    sourceRevision: summary.revision,
                },
            },
        ];
    }

    const isCopilot = filePath.includes('copilot-chat') || filePath.includes('debug-logs');
    const isDeepSeek = filePath.includes('deepseek') || filePath.includes('request-dumps');
    return [
        {
            session: {
                sourceName: isCopilot
                    ? 'copilot-vscode'
                    : isDeepSeek
                      ? 'deepseek-vscode'
                      : 'manual-export',
                sourceKind: isCopilot ? 'copilot_chat' : 'deepseek_request_dump',
                filePath,
                sessionId: sessionIdFromPath(filePath),
                sizeBytes,
                mtimeMs,
            },
        },
    ];
}
