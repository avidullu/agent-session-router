/**
 * Generic extractor for globalStorage-based agents (Tabby, Codeium, Amazon Q).
 *
 * Handles common chat/assistant JSON schemas found in these extensions.
 * Each agent's specific format may differ — this provides broad coverage
 * and can be refined once real data is available.
 *
 * STATUS: Needs real-world verification per agent.
 */

import * as fs from 'fs';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

function extractGeneric(filePath: string): ExtractedSession {
    const metadata: Record<string, unknown> = { session_id: 'unknown', source_file: filePath };
    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);

        if (data.sessionId || data.id || data.conversationId) {
            metadata.session_id = data.sessionId || data.id || data.conversationId;
        }
        if (data.title || data.name) metadata.title = data.title || data.name;

        // Try common message list keys
        for (const listKey of ['messages', 'history', 'conversation', 'chat', 'turns', 'items']) {
            const list = data[listKey];
            if (!Array.isArray(list)) continue;

            for (const item of list) {
                let role = item.role || item.type || item.speaker || 'message';
                let text = '';

                // Try multiple content shapes
                if (typeof item.content === 'string') text = item.content;
                else if (typeof item.text === 'string') text = item.text;
                else if (typeof item.message === 'string') text = item.message;
                else if (item.content && typeof item.content === 'object') {
                    if (typeof item.content.text === 'string') text = item.content.text;
                    else if (Array.isArray(item.content)) {
                        text = item.content
                            .filter((b: any) => b?.text)
                            .map((b: any) => b.text)
                            .join('\n');
                    }
                }

                let ts: string | undefined;
                if (item.timestamp) ts = new Date(item.timestamp).toISOString();
                else if (item.ts) ts = new Date(item.ts).toISOString();
                else if (item.createdAt) ts = new Date(item.createdAt).toISOString();

                if (text.trim()) {
                    messages.push({
                        role: normalizeRole(role),
                        text: text.trim(),
                        timestamp: ts,
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
    if (r === 'assistant' || r === 'ai' || r === 'bot' || r === 'model') return 'assistant';
    if (r === 'system' || r === 'developer') return 'system';
    return role || 'message';
}

registerExtractor('tabby', extractGeneric);
registerExtractor('codeium', extractGeneric);
registerExtractor('amazon_q', extractGeneric);
