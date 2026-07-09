/**
 * Gemini Antigravity session extractor.
 *
 * Parses Gemini Antigravity transcript JSONL into structured conversation
 * messages.  Handles both antigravity and antigravity-ide variants (same format).
 *
 * JSONL schema (one object per line):
 *   step_index:  number
 *   source:      "USER_EXPLICIT" | "MODEL" | "SYSTEM"
 *   type:        "USER_INPUT" | "PLANNER_RESPONSE" | "LIST_DIRECTORY" |
 *                "VIEW_FILE" | "RUN_COMMAND" | "COMMAND_STATUS" | ...
 *   status:      "DONE"
 *   created_at:  ISO-8601 timestamp
 *   content:     string (plain text or <USER_REQUEST>…</USER_REQUEST> wrapper)
 *   thinking:    string (model's internal reasoning trace)
 *   tool_calls:  Array<{ name, args, toolAction?, toolSummary? }>
 */

import * as fs from 'fs';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

// ---------------------------------------------------------------------------
// JSONL entry types
// ---------------------------------------------------------------------------

interface GeminiEntry {
    step_index?: number;
    source?: string;
    type?: string;
    status?: string;
    created_at?: string;
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
        name?: string;
        args?: Record<string, unknown>;
        toolAction?: string;
        toolSummary?: string;
    }>;
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

function extractGeminiAntigravity(filePath: string): ExtractedSession {
    const metadata: Record<string, unknown> = { source_file: filePath };
    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const lines = raw.split('\n').filter((line) => line.trim());

        for (const line of lines) {
            let entry: GeminiEntry;
            try {
                entry = JSON.parse(line);
            } catch {
                continue; // skip malformed JSON
            }

            const source = (entry.source || '').toUpperCase();
            const type = (entry.type || '').toUpperCase();
            const timestamp = entry.created_at || undefined;

            // ── Session metadata ──
            if (type === 'CONVERSATION_HISTORY' || type === 'EPHEMERAL_MESSAGE') {
                continue; // system-internal, not user-visible
            }

            // ── User messages ──
            if (source === 'USER_EXPLICIT' && type === 'USER_INPUT') {
                const text = unwrapUserRequest(entry.content || '');
                if (text.trim()) {
                    messages.push({ role: 'user', text, timestamp });
                }
                continue;
            }

            // ── Model messages ──
            if (source === 'MODEL') {
                // Include thinking trace if present
                if (entry.thinking && entry.thinking.trim()) {
                    messages.push({
                        role: 'thinking',
                        text: cleanThinking(entry.thinking),
                        timestamp,
                    });
                }

                // Include content if present
                if (entry.content && entry.content.trim()) {
                    messages.push({
                        role: 'assistant',
                        text: entry.content.trim(),
                        timestamp,
                    });
                }

                // Include tool calls
                if (Array.isArray(entry.tool_calls)) {
                    for (const tc of entry.tool_calls) {
                        const toolLines: string[] = [];
                        const toolName = tc.name || 'unknown';
                        const summary = tc.toolSummary || tc.toolAction || '';
                        toolLines.push(summary ? `**${summary}**` : `Tool call: ${toolName}`);
                        if (tc.args) {
                            toolLines.push('```json');
                            toolLines.push(JSON.stringify(tc.args, null, 2));
                            toolLines.push('```');
                        }
                        messages.push({
                            role: 'tool',
                            text: toolLines.join('\n'),
                            timestamp,
                            toolName,
                        });
                    }
                }

                continue;
            }

            // ── Tool execution results ──
            if (source === 'SYSTEM' && entry.content) {
                messages.push({
                    role: 'tool',
                    text: entry.content.trim(),
                    timestamp,
                });
                continue;
            }
        }
    } catch {
        // File read failed — return empty
    }

    return { metadata, messages };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip <USER_REQUEST>…</USER_REQUEST> wrapper and embedded <ADDITIONAL_METADATA>,
 * <USER_SETTINGS_CHANGE>, etc. blocks, keeping only the user's actual request text.
 */
function unwrapUserRequest(content: string): string {
    // Extract content inside <USER_REQUEST>…</USER_REQUEST>
    const requestMatch = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
    if (!requestMatch) return content.trim();

    let text = requestMatch[1];

    // Remove <ADDITIONAL_METADATA>…</ADDITIONAL_METADATA> blocks
    text = text.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '');

    // Remove <USER_SETTINGS_CHANGE>…</USER_SETTINGS_CHANGE> blocks
    text = text.replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '');

    // Remove <ENVIRONMENT>…</ENVIRONMENT> blocks
    text = text.replace(/<ENVIRONMENT>[\s\S]*?<\/ENVIRONMENT>/g, '');

    return text.trim();
}

/**
 * Clean up thinking trace text — strip any XML wrapper tags.
 */
function cleanThinking(thinking: string): string {
    // Strip common Gemini XML wrappers from thinking traces
    let text = thinking
        .replace(/<THINKING>[\s\S]*?<\/THINKING>/gi, (match) => {
            // Keep inner content, strip tags
            return match.replace(/<\/?THINKING>/gi, '');
        })
        .trim();

    // Collapse excessive blank lines
    text = text.replace(/\n{4,}/g, '\n\n');

    return text;
}

registerExtractor('gemini_antigravity', extractGeminiAntigravity);
