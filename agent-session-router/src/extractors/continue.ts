/**
 * Continue.dev session extractor (Phase 5 — P1).
 *
 * Parses Continue.dev session JSON files into structured conversation messages.
 *
 * Documented format (~/.continue/sessions/*.json):
 *   {
 *     "sessionId": "...",
 *     "title": "...",
 *     "history": [
 *       {"message": {"role": "user", "content": "..."}},
 *       {"message": {"role": "assistant", "content": "..."}},
 *       ...
 *     ]
 *   }
 *
 * STATUS: Code-complete, needs real-world verification.
 */

import * as fs from 'fs';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

interface ContinueSession {
    sessionId?: string;
    title?: string;
    history?: ContinueMessage[];
    // Alternate schema (older versions)
    messages?: ContinueMessage[];
}

interface ContinueMessage {
    message?: {
        role?: string;
        content?: string;
    };
    // Direct schema (some versions)
    role?: string;
    content?: string;
    timestamp?: string;
}

function extractContinue(filePath: string): ExtractedSession {
    const metadata: Record<string, unknown> = { session_id: 'unknown', source_file: filePath };
    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data: ContinueSession = JSON.parse(raw);

        if (data.sessionId) {
            metadata.session_id = data.sessionId;
        }
        if (data.title) {
            metadata.title = data.title;
        }

        // Try documented schema: history[].message.{role, content}
        const history = data.history || data.messages || [];
        if (Array.isArray(history)) {
            for (const item of history) {
                // Schema 1: {message: {role, content}}
                if (item.message?.content) {
                    messages.push({
                        role: item.message.role || 'message',
                        text: item.message.content,
                        timestamp: item.timestamp,
                    });
                    continue;
                }
                // Schema 2: {role, content} (direct)
                if (item.content) {
                    messages.push({
                        role: item.role || 'message',
                        text: item.content,
                        timestamp: item.timestamp,
                    });
                }
            }
        }
    } catch {
        // JSON parse failed — file may be malformed or not a session file
    }

    return { metadata, messages };
}

registerExtractor('continue_dev', extractContinue);
