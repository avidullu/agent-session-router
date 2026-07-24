/**
 * Tabby session discoverer (Phase 5 — P3).
 *
 * Tabby is a self-hosted AI coding assistant.
 *
 * Session storage: globalStorage/tabbyml.tabby/
 * STATUS: Needs real-world verification.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

function getRoots(id: string): string[] {
    const r: string[] = [];
    const a = process.env.APPDATA;
    if (a) r.push(path.join(a, 'Code', 'User', 'globalStorage', id));
    const c = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    r.push(path.join(c, 'Code', 'User', 'globalStorage', id));
    r.push(
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'globalStorage',
            id,
        ),
    );
    return r;
}

function discoverFromRoots(
    id: string,
    kind: string,
    sourceName: string,
): () => AsyncIterable<DiscoveredSession> {
    return async function* () {
        for (const root of getRoots(id)) {
            if (!fs.existsSync(root)) continue;
            const results: DiscoveredSession[] = [];
            const collect = (dir: string, d: number): void => {
                if (d > 4) return;
                try {
                    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                        const p = path.join(dir, e.name);
                        if (e.isDirectory()) {
                            collect(p, d + 1);
                            continue;
                        }
                        if (!e.name.endsWith('.json') && !e.name.endsWith('.jsonl')) continue;
                        try {
                            const s = fs.statSync(p);
                            results.push({
                                sourceName,
                                sourceKind: kind,
                                filePath: p,
                                sessionId: e.name.replace(/\.(json|jsonl)$/, ''),
                                sizeBytes: s.size,
                                mtimeMs: s.mtimeMs,
                            });
                        } catch {
                            /* skip */
                        }
                    }
                } catch {
                    /* skip */
                }
            };
            collect(root, 0);
            for (const s of results) yield s;
        }
    };
}

registerDiscoverer('tabby', discoverFromRoots('tabbyml.tabby', 'tabby', 'tabby'));
registerDiscoverer('codeium', discoverFromRoots('codeium.codeium', 'codeium', 'codeium'));
registerDiscoverer(
    'amazon_q',
    discoverFromRoots('amazonwebservices.amazon-q-vscode', 'amazon_q', 'amazon-q'),
);
