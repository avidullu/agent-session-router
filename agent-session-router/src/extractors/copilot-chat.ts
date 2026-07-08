/**
 * Copilot Chat session extractor (enhanced — Phase 2).
 *
 * Parses Copilot Chat transcript JSONL into structured conversation messages.
 *
 * Source formats handled:
 *   1. transcripts/{uuid}.jsonl — structured conversation (primary)
 *      Types: session.start, assistant.turn_start/end, assistant.message,
 *             tool.execution_start/complete
 *   2. debug-logs/{uuid}/main.jsonl — basic session timeline (fallback)
 *
 * Cross-references chat-session-resources for full tool output content.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

// ---------------------------------------------------------------------------
// Transcript format (primary — transcripts/{uuid}.jsonl)
// ---------------------------------------------------------------------------

interface TranscriptEntry {
    type: string;
    data?: Record<string, unknown>;
    id?: string;
    timestamp?: string;
    parentId?: string | null;
}

interface AssistantMessageData {
    messageId?: string;
    content?: string;
    toolRequests?: Array<{
        toolCallId?: string;
        name?: string;
        arguments?: string;
        type?: string;
    }>;
}

interface ToolExecutionData {
    toolCallId?: string;
    success?: boolean;
}

// ---------------------------------------------------------------------------
// Debug-log format (fallback — debug-logs/{uuid}/main.jsonl)
// ---------------------------------------------------------------------------

interface DebugLogEntry {
    v?: number;
    ts?: number;
    type?: string;
    name?: string;
    attrs?: Record<string, unknown>;
    content?: string;
    role?: string;
    message?: {
        role?: string;
        content?: string | Array<{ type: string; text?: string }>;
    };
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

function extractCopilotChat(filePath: string): ExtractedSession {
    const isTranscript = filePath.includes('transcripts') && filePath.endsWith('.jsonl');
    const sessionId = extractSessionId(filePath);

    if (isTranscript) {
        return extractTranscriptFormat(filePath, sessionId);
    }
    return extractDebugLogFormat(filePath, sessionId);
}

function extractSessionId(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[i])) {
            return parts[i];
        }
    }
    return path.basename(filePath, path.extname(filePath));
}

// ---------------------------------------------------------------------------
// Transcript format extraction
// ---------------------------------------------------------------------------

function extractTranscriptFormat(filePath: string, sessionId: string): ExtractedSession {
    const metadata: Record<string, unknown> = { session_id: sessionId, source_file: filePath };
    const messages: SessionMessage[] = [];
    const toolOutputs = loadToolOutputs(filePath, sessionId);

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const lines = raw.split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const entry: TranscriptEntry = JSON.parse(line);

                switch (entry.type) {
                    case 'session.start':
                        if (entry.data) {
                            if (entry.data.copilotVersion) metadata.copilot_version = entry.data.copilotVersion;
                            if (entry.data.vscodeVersion) metadata.vscode_version = entry.data.vscodeVersion;
                            if (entry.data.startTime) metadata.start_time = entry.data.startTime;
                        }
                        break;

                    case 'assistant.turn_start':
                        messages.push({
                            role: 'system',
                            text: `[Turn ${entry.data?.turnId || '?'} started]`,
                            timestamp: entry.timestamp,
                        });
                        break;

                    case 'assistant.message': {
                        const data = entry.data as AssistantMessageData | undefined;
                        if (!data) break;

                        const content = data.content || '';
                        if (content.trim()) {
                            messages.push({
                                role: 'assistant',
                                text: content.trim(),
                                timestamp: entry.timestamp,
                            });
                        }

                        if (Array.isArray(data.toolRequests)) {
                            for (const tr of data.toolRequests) {
                                const toolLines: string[] = [`Tool call: ${tr.name || 'unknown'}`];
                                if (tr.arguments) {
                                    try {
                                        const args = JSON.parse(tr.arguments);
                                        toolLines.push(`Arguments: ${JSON.stringify(args, null, 2)}`);
                                    } catch {
                                        toolLines.push(`Arguments: ${tr.arguments}`);
                                    }
                                }
                                if (tr.toolCallId) {
                                    toolLines.push(`Call ID: ${tr.toolCallId}`);
                                }
                                messages.push({
                                    role: 'tool',
                                    text: toolLines.join('\n'),
                                    timestamp: entry.timestamp,
                                    toolCallId: tr.toolCallId,
                                    toolName: tr.name,
                                });
                            }
                        }
                        break;
                    }

                    case 'tool.execution_start': {
                        const data = entry.data as ToolExecutionData | undefined;
                        if (data?.toolCallId) {
                            messages.push({
                                role: 'tool',
                                text: `[Tool execution started: ${data.toolCallId}]`,
                                timestamp: entry.timestamp,
                                toolCallId: data.toolCallId,
                            });
                        }
                        break;
                    }

                    case 'tool.execution_complete': {
                        const data = entry.data as ToolExecutionData | undefined;
                        if (data?.toolCallId) {
                            const output = toolOutputs.get(data.toolCallId) || '';
                            const status = data.success ? 'SUCCESS' : 'FAILED';
                            const resultText = output
                                ? `[Tool result: ${status}]\n\n${output.trim()}`
                                : `[Tool result: ${status} (no output)]`;
                            messages.push({
                                role: 'tool',
                                text: resultText,
                                timestamp: entry.timestamp,
                                toolCallId: data.toolCallId,
                            });
                        }
                        break;
                    }

                    case 'assistant.turn_end':
                        break;

                    default:
                        break;
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

// ---------------------------------------------------------------------------
// Debug-log format extraction (fallback)
// ---------------------------------------------------------------------------

function extractDebugLogFormat(filePath: string, sessionId: string): ExtractedSession {
    const metadata: Record<string, unknown> = { session_id: sessionId, source_file: filePath };
    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const lines = raw.split('\n').filter(line => line.trim());

        for (const line of lines) {
            try {
                const entry: DebugLogEntry = JSON.parse(line);

                if (entry.type === 'session_start' && entry.attrs) {
                    if (entry.attrs.copilotVersion) metadata.copilot_version = entry.attrs.copilotVersion;
                    if (entry.attrs.vscodeVersion) metadata.vscode_version = entry.attrs.vscodeVersion;
                    continue;
                }

                let role = entry.role || entry.message?.role || entry.name || entry.type || '';
                let text = '';

                const content = entry.message?.content || entry.content;
                if (typeof content === 'string') {
                    text = content;
                } else if (Array.isArray(content)) {
                    text = content
                        .filter((block): block is { type: string; text?: string } =>
                            typeof block === 'object' && block !== null)
                        .map(block => block.text || '')
                        .join('\n');
                }

                const normalizedRole = normalizeRole(role);

                if (text.trim()) {
                    const ts = entry.ts ? new Date(entry.ts).toISOString() : undefined;
                    messages.push({
                        role: normalizedRole,
                        text: text.trim(),
                        timestamp: ts,
                    });
                }
            } catch {
                // Skip malformed JSON lines
            }
        }
    } catch {
        // File read failed
    }

    return { metadata, messages };
}

// ---------------------------------------------------------------------------
// Tool output cross-referencing
// ---------------------------------------------------------------------------

function loadToolOutputs(filePath: string, sessionId: string): Map<string, string> {
    const outputs = new Map<string, string>();

    const transcriptsDir = path.dirname(filePath);
    const copilotDir = path.dirname(transcriptsDir);
    const resourcesDir = path.join(copilotDir, 'chat-session-resources', sessionId);

    if (!fs.existsSync(resourcesDir)) return outputs;

    try {
        const callDirs = fs.readdirSync(resourcesDir, { withFileTypes: true });
        for (const dir of callDirs) {
            if (!dir.isDirectory()) continue;

            const match = dir.name.match(/^call_(.+?)__vscode-/);
            if (!match) continue;

            const toolCallId = match[1];
            const contentFile = path.join(resourcesDir, dir.name, 'content.txt');

            if (fs.existsSync(contentFile)) {
                try {
                    const content = fs.readFileSync(contentFile, 'utf-8');
                    outputs.set(toolCallId, content.slice(0, 50_000));
                } catch {
                    // Skip unreadable files
                }
            }
        }
    } catch {
        // Directory read failed
    }

    return outputs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
