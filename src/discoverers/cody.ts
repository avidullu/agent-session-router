/**
 * Cody session discoverer (Phase 5 — P2).
 *
 * Cody (by Sourcegraph) is an AI coding assistant with enterprise adoption.
 *
 * Session storage: globalStorage/sourcegraph.cody/
 * Format: Custom (needs on-machine verification).
 *
 * STATUS: Needs real-world verification.
 *   Install Cody (sourcegraph.cody) and run a test chat to validate.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

const CODY_EXTENSION_ID = 'sourcegraph.cody';

function getCodyStorageRoots(): string[] {
    const roots: string[] = [];
    const appData = process.env.APPDATA;
    if (appData) {
        roots.push(path.join(appData, 'Code', 'User', 'globalStorage', CODY_EXTENSION_ID));
    }
    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    roots.push(path.join(configDir, 'Code', 'User', 'globalStorage', CODY_EXTENSION_ID));
    roots.push(
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'globalStorage',
            CODY_EXTENSION_ID,
        ),
    );
    return roots;
}

async function* discoverCodySessions(): AsyncIterable<DiscoveredSession> {
    for (const root of getCodyStorageRoots()) {
        if (!fs.existsSync(root)) continue;

        const results: DiscoveredSession[] = [];
        const collect = (dir: string, depth: number): void => {
            if (depth > 4) return;
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        collect(fullPath, depth + 1);
                    } else if (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')) {
                        try {
                            const stat = fs.statSync(fullPath);
                            results.push({
                                sourceName: 'cody',
                                sourceKind: 'cody',
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
        collect(root, 0);
        for (const session of results) yield session;
    }
}

registerDiscoverer('cody', () => discoverCodySessions());
