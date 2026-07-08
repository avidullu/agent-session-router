/**
 * Cody session extractor (Phase 5 — P2).
 *
 * Parses Cody chat history JSON into structured messages.
 * Format TBD — needs on-machine verification.
 *
 * STATUS: Needs real-world verification.
 */

import * as fs from 'fs';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

function extractCody(filePath: string): ExtractedSession {
    const metadata: Record<string, unknown> = { session_id: 'unknown', source_file: filePath };
    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);

        if (data.sessionId || data.id) metadata.session_id = data.sessionId || data.id;
        if (data.title) metadata.title = data.title;

        // Try common Cody message schemas
        for (const listKey of ['messages', 'history', 'transcript', 'chatMessages']) {
            const list = data[listKey];
            if (!Array.isArray(list)) continue;

            for (const item of list) {
                let role = item.role || item.speaker || 'message';
                let text = item.content || item.text || item.message || '';
                const ts = item.timestamp || item.ts || item.createdAt;

                if (typeof text !== 'string') {
                    if (typeof item.message?.content === 'string') text = item.message.content;
                    else if (Array.isArray(item.message?.content)) {
                        text = item.message.content
                            .filter((b: any) => b?.text)
                            .map((b: any) => b.text)
                            .join('\n');
                    } else text = '';
                }

                if (text.trim()) {
                    messages.push({
                        role: normalizeRole(role),
                        text: text.trim(),
                        timestamp: ts ? new Date(ts).toISOString() : undefined,
                    });
                }
            }
            if (messages.length > 0) break;
        }
    } catch { /* parse failed */ }

    return { metadata, messages };
}

function normalizeRole(role: string): string {
    const r = role.toLowerCase();
    if (r === 'user' || r === 'human') return 'user';
    if (r === 'assistant' || r === 'ai' || r === 'bot') return 'assistant';
    if (r === 'system') return 'system';
    return role || 'message';
}

registerExtractor('cody', extractCody);
