/**
 * Cline session discoverer (Phase 5 — P1).
 *
 * Cline (formerly Claude Dev) is a VS Code extension that connects to multiple
 * LLM backends (Ollama, OpenAI, Anthropic, OpenRouter, etc.).
 *
 * Session storage: globalStorage/saoudrizwan.claude-dev/tasks/
 * Format: JSON task files with conversation history.
 *
 * STATUS: Code-complete, needs real-world verification.
 *   Install Cline (saoudrizwan.claude-dev) and run a test task to validate.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

const CLINE_EXTENSION_ID = 'saoudrizwan.claude-dev';

function getClineStorageRoots(): string[] {
    const roots: string[] = [];
    const appData = process.env.APPDATA;
    if (appData) {
        roots.push(
            path.join(appData, 'Code', 'User', 'globalStorage', CLINE_EXTENSION_ID, 'tasks'),
        );
    }
    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    roots.push(path.join(configDir, 'Code', 'User', 'globalStorage', CLINE_EXTENSION_ID, 'tasks'));
    roots.push(
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'globalStorage',
            CLINE_EXTENSION_ID,
            'tasks',
        ),
    );
    return roots;
}

async function* discoverClineSessions(): AsyncIterable<DiscoveredSession> {
    for (const root of getClineStorageRoots()) {
        if (!fs.existsSync(root)) continue;

        const results: DiscoveredSession[] = [];
        const collect = (dir: string): void => {
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        collect(fullPath);
                    } else if (entry.name.endsWith('.json')) {
                        try {
                            const stat = fs.statSync(fullPath);
                            results.push({
                                sourceName: 'cline',
                                sourceKind: 'cline',
                                filePath: fullPath,
                                sessionId: entry.name.replace('.json', ''),
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
        collect(root);

        for (const session of results) {
            yield session;
        }
    }
}

registerDiscoverer('cline', () => discoverClineSessions());
