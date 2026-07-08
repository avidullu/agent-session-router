/**
 * DeepSeek V4 session extractor.
 *
 * Parses DeepSeek request-dump JSON files into structured conversation messages.
 *
 * Handles TWO schemas found in real request dumps:
 *   1. Provider-input format: model (object), messages with contentParts array
 *   2. Simple format: model (string), messages with content (string)
 *
 * The provider input JSON contains the full message array sent to the model,
 * including system prompt, user messages, and assistant responses.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

// ---------------------------------------------------------------------------
// Provider-input format (real-world schema)
// ---------------------------------------------------------------------------

interface ContentPart {
    index?: number;
    type?: string;
    value?: string;
}

interface DeepSeekMessageReal {
    index?: number;
    role?: string;
    contentPartCount?: number;
    contentTextChars?: number;
    contentDataBytes?: number;
    contentParts?: ContentPart[];
    toolCalls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
    }>;
    toolCallId?: string;
    name?: string;
}

interface DeepSeekInputReal {
    model?: {
        vscodeModelId?: string;
        name?: string;
        family?: string;
        version?: string;
        maxInputTokens?: number;
        maxOutputTokens?: number;
    };
    messages?: DeepSeekMessageReal[];
    messageStats?: Record<string, unknown>;
    systemPromptSummary?: string;
    requestKind?: string;
    stage?: string;
    timestamp?: string;
}

// ---------------------------------------------------------------------------
// Simple format (legacy / request body)
// ---------------------------------------------------------------------------

interface DeepSeekMessageSimple {
    role: string;
    content: string | null;
    tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
    }>;
    tool_call_id?: string;
    name?: string;
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

function extractDeepSeek(filePath: string): ExtractedSession {
    const sessionDir = path.dirname(filePath);
    const sessionId = path.basename(sessionDir);
    const raw = fs.readFileSync(filePath, 'utf-8');

    const metadata: Record<string, unknown> = {
        session_id: sessionId,
        source_file: filePath,
    };

    const messages: SessionMessage[] = [];

    try {
        const data = JSON.parse(raw);

        // ---- Detect schema ----
        if (Array.isArray(data.messages) && data.messages.length > 0) {
            const firstMsg = data.messages[0];

            // Real-world provider-input schema: contentParts array
            if (Array.isArray(firstMsg.contentParts)) {
                return extractProviderInputFormat(data, metadata);
            }

            // Simple schema: content string
            if (typeof firstMsg.content === 'string' || firstMsg.content === null) {
                return extractSimpleFormat(data, metadata);
            }
        }

        // Fallback: try simple format anyway
        return extractSimpleFormat(data, metadata);
    } catch {
        messages.push({ role: 'request-prompt', text: raw });
    }

    return { metadata, messages };
}

// ---------------------------------------------------------------------------
// Provider-input format (real-world)
// ---------------------------------------------------------------------------

function extractProviderInputFormat(
    data: DeepSeekInputReal,
    metadata: Record<string, unknown>,
): ExtractedSession {
    const messages: SessionMessage[] = [];

    // Extract model info
    if (data.model && typeof data.model === 'object') {
        metadata.model = data.model.vscodeModelId || data.model.name || 'unknown';
        metadata.model_family = data.model.family;
        metadata.model_version = data.model.version;
        metadata.model_max_input_tokens = data.model.maxInputTokens;
        metadata.model_max_output_tokens = data.model.maxOutputTokens;
    }

    // Extract message stats
    if (data.messageStats) {
        metadata.message_stats = JSON.stringify(data.messageStats);
    }
    if (data.requestKind) {
        metadata.request_kind = data.requestKind;
    }
    if (data.systemPromptSummary) {
        metadata.system_prompt_summary = data.systemPromptSummary;
    }

    // Parse messages
    if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
            // Reconstruct content from contentParts
            let text = '';
            if (Array.isArray(msg.contentParts)) {
                text = msg.contentParts
                    .filter((p: ContentPart) => p.type === 'text' && p.value)
                    .map((p: ContentPart) => p.value!)
                    .join('\n');
            }

            const role = msg.role || 'unknown';

            // Handle tool calls on assistant messages
            if (Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
                for (const tc of msg.toolCalls) {
                    const toolLines: string[] = [];
                    if (text.trim()) {
                        toolLines.push(text.trim());
                        toolLines.push('');
                    }
                    toolLines.push(`[Tool Call: ${tc.function?.name || 'unknown'}]`);
                    if (tc.function?.arguments) {
                        try {
                            const args = JSON.parse(tc.function.arguments);
                            toolLines.push(`Arguments: ${JSON.stringify(args, null, 2)}`);
                        } catch {
                            toolLines.push(`Arguments: ${tc.function.arguments}`);
                        }
                    }
                    messages.push({
                        role: 'tool',
                        text: toolLines.join('\n'),
                        toolCallId: tc.id,
                        toolName: tc.function?.name,
                    });
                }
                // Skip the main message if it only contained tool calls
                if (!text.trim()) continue;
            }

            // Handle tool responses
            if (msg.toolCallId) {
                messages.push({
                    role: 'tool',
                    text: text.trim() || `[Tool result: ${msg.name || 'unknown'}]`,
                    toolCallId: msg.toolCallId,
                    toolName: msg.name,
                });
                continue;
            }

            // Regular message
            if (text.trim()) {
                messages.push({ role, text: text.trim() });
            }
        }
    }

    return { metadata, messages };
}

// ---------------------------------------------------------------------------
// Simple format (legacy)
// ---------------------------------------------------------------------------

function extractSimpleFormat(
    data: Record<string, unknown>,
    metadata: Record<string, unknown>,
): ExtractedSession {
    const messages: SessionMessage[] = [];

    if (typeof data.model === 'string') {
        metadata.model = data.model;
    }

    const rawMessages = data.messages;
    if (!Array.isArray(rawMessages)) {
        return { metadata, messages };
    }

    for (const msg of rawMessages) {
        const m = msg as DeepSeekMessageSimple;
        const text = typeof m.content === 'string' ? m.content : '';
        const role = m.role || 'unknown';

        if (m.tool_calls && m.tool_calls.length > 0) {
            for (const tc of m.tool_calls) {
                const toolLines = [`Tool: ${tc.function?.name || 'unknown'}`];
                if (tc.function?.arguments) {
                    try {
                        const args = JSON.parse(tc.function.arguments);
                        toolLines.push(`Arguments: ${JSON.stringify(args, null, 2)}`);
                    } catch {
                        toolLines.push(`Arguments: ${tc.function.arguments}`);
                    }
                }
                messages.push({
                    role: 'tool',
                    text: (text ? text + '\n\n' : '') + toolLines.join('\n'),
                    toolCallId: tc.id,
                    toolName: tc.function?.name,
                });
            }
        } else if (m.tool_call_id) {
            messages.push({
                role: 'tool',
                text: text || `[Tool result: ${m.name || 'unknown'}]`,
                toolCallId: m.tool_call_id,
                toolName: m.name,
            });
        } else if (text.trim()) {
            messages.push({ role, text: text.trim() });
        }
    }

    return { metadata, messages };
}

registerExtractor('deepseek_request_dump', extractDeepSeek);
