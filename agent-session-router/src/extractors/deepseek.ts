/**
 * DeepSeek V4 session extractor.
 *
 * Parses DeepSeek request-dump JSON files into structured conversation messages.
 * The provider input JSON contains the full message array sent to the model,
 * including system prompt, user messages, and assistant responses.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

interface DeepSeekMessage {
    role: string;
    content: string | null;
    tool_calls?: Array<{
        id?: string;
        function?: { name?: string; arguments?: string };
    }>;
    tool_call_id?: string;
    name?: string;
}

interface DeepSeekInput {
    messages?: DeepSeekMessage[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
}

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
        const data: DeepSeekInput = JSON.parse(raw);
        if (data.model) {
            metadata.model = data.model;
        }

        if (Array.isArray(data.messages)) {
            for (const msg of data.messages) {
                const text = typeof msg.content === 'string' ? msg.content : '';
                const role = msg.role || 'unknown';

                const sessionMsg: SessionMessage = { role, text };

                // Map tool_calls to tool-call messages
                if (msg.tool_calls && msg.tool_calls.length > 0) {
                    for (const tc of msg.tool_calls) {
                        sessionMsg.toolCallId = tc.id;
                        sessionMsg.toolName = tc.function?.name;
                        // Include tool call details in the text
                        const toolInfo = [`Tool: ${tc.function?.name || 'unknown'}`];
                        if (tc.function?.arguments) {
                            try {
                                const args = JSON.parse(tc.function.arguments);
                                toolInfo.push(`Arguments: ${JSON.stringify(args, null, 2)}`);
                            } catch {
                                toolInfo.push(`Arguments: ${tc.function.arguments}`);
                            }
                        }
                        sessionMsg.text = (text ? text + '\n\n' : '') + toolInfo.join('\n');
                    }
                }

                // Map tool responses
                if (msg.tool_call_id) {
                    sessionMsg.toolCallId = msg.tool_call_id;
                    sessionMsg.toolName = msg.name;
                }

                if (sessionMsg.text.trim()) {
                    messages.push(sessionMsg);
                }
            }
        }
    } catch {
        // If JSON parse fails, treat the whole file as a raw request prompt
        messages.push({
            role: 'request-prompt',
            text: raw,
        });
    }

    return { metadata, messages };
}

registerExtractor('deepseek_request_dump', extractDeepSeek);
