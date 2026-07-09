/**
 * Continue.dev session discoverer (Phase 5 — P1).
 *
 * Continue.dev is an open-source AI code assistant that connects to multiple
 * LLM backends (Ollama, OpenAI, Anthropic, OpenRouter, LM Studio, etc.).
 *
 * Session storage: ~/.continue/sessions/*.json
 * Format: JSON with {sessionId, title, history: [{message: {role, content}}]}
 *
 * STATUS: Code-complete, needs real-world verification.
 *   Install Continue (continue.continue) and run a test session to validate.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

function getContinueSessionRoot(): string {
    return path.join(os.homedir(), '.continue', 'sessions');
}

async function* discoverContinueSessions(): AsyncIterable<DiscoveredSession> {
    const sessionsDir = getContinueSessionRoot();
    if (!fs.existsSync(sessionsDir)) return;

    // Collect sessions recursively, then yield
    const results: DiscoveredSession[] = [];
    const collect = (dir: string): void => {
        try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    collect(fullPath);
                } else if (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')) {
                    try {
                        const stat = fs.statSync(fullPath);
                        results.push({
                            sourceName: 'continue-dev',
                            sourceKind: 'continue_dev',
                            filePath: fullPath,
                            sessionId: entry.name.replace(/\.(json|jsonl)$/, ''),
                            sizeBytes: stat.size,
                            mtimeMs: stat.mtimeMs,
                        });
                    } catch {
                        /* skip */
                    }
                }
            }
        } catch {
            /* skip */
        }
    };
    collect(sessionsDir);

    for (const session of results) {
        yield session;
    }
}

registerDiscoverer('continue_dev', () => discoverContinueSessions());
