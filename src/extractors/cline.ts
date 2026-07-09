/**
 * Cline session extractor (Phase 5 — P1).
 *
 * Parses Cline task history JSON files into structured conversation messages.
 *
 * Documented format (globalStorage/saoudrizwan.claude-dev/tasks/*.json):
 *   {
 *     "taskId": "...",
 *     "task": "original task description",
 *     "messages": [
 *       {"role": "user", "content": "...", "ts": 1234567890},
 *       {"role": "assistant", "content": "...", "ts": 1234567891},
 *       ...
 *     ]
 *   }
 *
 * STATUS: Code-complete, needs real-world verification.
 */

import * as fs from 'fs';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

interface ClineTask {
    taskId?: string;
    task?: string;
    messages?: ClineTaskMessage[];
    // Alternate schemas
    history?: ClineTaskMessage[];
    conversation?: ClineTaskMessage[];
}

interface ClineTaskMessage {
    role?: string;
    content?: string;
    text?: string;
    ts?: number;
    timestamp?: string;
    // Nested message format
    message?: {
        role?: string;
        content?: string | Array<{ type: string; text?: string }>;
    };
}

function extractCline(filePath: string): ExtractedSession {
    const metadata: Record<string, unknown> = { session_id: 'unknown', source_file: filePath };
    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data: ClineTask = JSON.parse(raw);

        if (data.taskId) {
            metadata.session_id = data.taskId;
        }
        if (data.task) {
            metadata.task = data.task;
        }

        const msgList = data.messages || data.history || data.conversation || [];
        if (Array.isArray(msgList)) {
            for (const item of msgList) {
                // Schema 1: {role, content/text, ts}
                let text = item.content || item.text || '';
                let role = item.role || 'message';
                let ts: string | undefined;

                if (item.ts) {
                    ts = new Date(item.ts).toISOString();
                } else if (item.timestamp) {
                    ts = item.timestamp;
                }

                // Schema 2: {message: {role, content}}
                if (!text && item.message) {
                    const mContent = item.message.content;
                    if (typeof mContent === 'string') {
                        text = mContent;
                    } else if (Array.isArray(mContent)) {
                        text = mContent
                            .filter((b): b is { type: string; text?: string } =>
                                typeof b === 'object' && b !== null)
                            .map(b => b.text || '')
                            .join('\n');
                    }
                    role = item.message.role || role;
                    // ts may be on outer item
                    if (item.ts) ts = new Date(item.ts).toISOString();
                }

                if (text.trim()) {
                    messages.push({
                        role: normalizeRole(role),
                        text: text.trim(),
                        timestamp: ts,
                    });
                }
            }
        }
    } catch {
        // JSON parse failed
    }

    return { metadata, messages };
}

function normalizeRole(role: string): string {
    const r = role.toLowerCase();
    if (r === 'user' || r === 'human') return 'user';
    if (r === 'assistant' || r === 'ai' || r === 'model') return 'assistant';
    if (r === 'system' || r === 'developer') return 'system';
    if (r === 'tool' || r === 'function') return 'tool';
    return role || 'message';
}

registerExtractor('cline', extractCline);
