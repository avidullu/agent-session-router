/**
 * Aider session extractor (Phase 5 — P2).
 *
 * Aider stores sessions as .aider.chat.history.md (Markdown) and
 * .aider.input.history (JSONL). The Markdown format is already close
 * to what we produce.
 *
 * STATUS: Needs real-world verification.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExtractedSession, SessionMessage } from '../types';
import { registerExtractor } from './index';

function extractAider(filePath: string): ExtractedSession {
    const metadata: Record<string, unknown> = {
        session_id:
            path.basename(path.dirname(filePath)) +
            '_' +
            path.basename(filePath, path.extname(filePath)),
        source_file: filePath,
    };
    const messages: SessionMessage[] = [];

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');

        if (filePath.endsWith('.jsonl') || filePath.includes('input')) {
            // JSONL format: {role, content} per line
            for (const line of raw.split('\n').filter((l) => l.trim())) {
                try {
                    const entry = JSON.parse(line);
                    let text = '';
                    if (typeof entry.content === 'string') {
                        text = entry.content;
                    } else if (typeof entry.content === 'object' && entry.content !== null) {
                        text = JSON.stringify(entry.content);
                    }
                    if (text.trim()) {
                        messages.push({
                            role: entry.role || 'message',
                            text: text.trim(),
                            timestamp: entry.timestamp,
                        });
                    }
                } catch {
                    /* skip malformed */
                }
            }
        } else {
            // Markdown format: ## role blocks
            const sections = raw.split(/^## /m).filter((s) => s.trim());
            for (const section of sections) {
                const newlineIdx = section.indexOf('\n');
                const heading =
                    newlineIdx > 0 ? section.slice(0, newlineIdx).trim() : section.trim();
                const body = newlineIdx > 0 ? section.slice(newlineIdx + 1).trim() : '';

                // Parse role from heading (e.g., "user", "assistant", "AI")
                const role = heading.toLowerCase().includes('user')
                    ? 'user'
                    : heading.toLowerCase().includes('assistant') ||
                        heading.toLowerCase().includes('ai')
                      ? 'assistant'
                      : 'message';

                if (body) {
                    messages.push({ role, text: body });
                }
            }
        }
    } catch {
        /* parse failed */
    }

    return { metadata, messages };
}

registerExtractor('aider', extractAider);
