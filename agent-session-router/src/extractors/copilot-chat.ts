/**
 * Copilot Chat session extractor.
 *
 * Parses Copilot Chat debug-logs JSONL (main.jsonl) into structured conversation
 * messages. Cross-references chat-session-resources for full message content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

interface CopilotLogEntry {
    v?: number;
    ts?: number;
    dur?: number;
    sid?: string;
    type?: string;
    name?: string;
    spanId?: string;
    status?: string;
    attrs?: Record<string, unknown>;
    content?: string;
    role?: string;
    message?: {
        role?: string;
        content?: string | Array<{ type: string; text?: string }>;
    };
}

function extractCopilotChat(filePath: string): ExtractedSession {
    // main.jsonl is in debug-logs/{uuid}/main.jsonl
    const sessionDir = path.dirname(filePath);
    const sessionId = path.basename(sessionDir);

    const metadata: Record<string, unknown> = {
        session_id: sessionId,
        source_file: filePath,
    };

    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const lines = raw.split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const entry: CopilotLogEntry = JSON.parse(line);

                // Extract session start metadata
                if (entry.type === 'session_start' && entry.attrs) {
                    if (entry.attrs.copilotVersion) {
                        metadata.copilot_version = entry.attrs.copilotVersion;
                    }
                    if (entry.attrs.vscodeVersion) {
                        metadata.vscode_version = entry.attrs.vscodeVersion;
                    }
                    continue;
                }

                // Extract message content from various Copilot log entry shapes
                let role = entry.role || entry.message?.role || entry.name || entry.type || '';
                let text = '';

                // Try message.content (can be string or array of content blocks)
                const content = entry.message?.content || entry.content;
                if (typeof content === 'string') {
                    text = content;
                } else if (Array.isArray(content)) {
                    text = content
                        .filter((block): block is { type: string; text?: string } => typeof block === 'object' && block !== null)
                        .map(block => block.text || '')
                        .join('\n');
                }

                // Normalize roles to match Agent Sessions convention
                const normalizedRole = normalizeRole(role);

                if (text.trim()) {
                    const ts = entry.ts ? new Date(entry.ts).toISOString() : undefined;
                    messages.push({
                        role: normalizedRole,
                        text: text.trim(),
                        timestamp: ts,
                    });
                }

                // Also capture span attributes as context
                if (entry.attrs && entry.name && !text.trim()) {
                    const attrsStr = JSON.stringify(entry.attrs, null, 2);
                    if (attrsStr.length > 10) {
                        messages.push({
                            role: 'metadata',
                            text: `[${entry.name}] ${attrsStr}`,
                            timestamp: entry.ts ? new Date(entry.ts).toISOString() : undefined,
                        });
                    }
                }
            } catch {
                // Skip malformed JSON lines
            }
        }
    } catch {
        // File read failed — return empty
    }

    return { metadata, messages };
}

function normalizeRole(role: string): string {
    const r = role.toLowerCase();
    if (r === 'user' || r === 'human') return 'user';
    if (r === 'assistant' || r === 'ai' || r === 'model' || r === 'copilot') return 'assistant';
    if (r === 'system' || r === 'developer') return 'system';
    if (r === 'tool' || r === 'function' || r === 'tool_call') return 'tool';
    if (r === 'session_start' || r === 'session_end') return 'metadata';
    return role || 'message';
}

registerExtractor('copilot_chat', extractCopilotChat);
