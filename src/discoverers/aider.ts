/**
 * Aider VS Code session discoverer (Phase 5 — P2).
 *
 * Aider is a terminal AI coding tool with a VS Code companion extension.
 * Sessions are stored as .aider* files in project directories.
 *
 * STATUS: Needs real-world verification.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

function getWorkspaceRoots(): string[] {
    const roots: string[] = [];
    // Check common project locations
    const home = process.env.USERPROFILE || '~';
    for (const dir of ['Projects', 'projects', 'src', 'dev']) {
        const p = path.join(home, dir);
        if (fs.existsSync(p)) roots.push(p);
    }
    return roots;
}

async function* discoverAiderSessions(): AsyncIterable<DiscoveredSession> {
    for (const root of getWorkspaceRoots()) {
        try {
            for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
                if (!entry.isDirectory()) continue;
                const projectDir = path.join(root, entry.name);
                // Aider stores .aider.chat.history.md, .aider.input.history, etc.
                try {
                    for (const file of fs.readdirSync(projectDir)) {
                        if (!file.startsWith('.aider')) continue;
                        const filePath = path.join(projectDir, file);
                        const stat = fs.statSync(filePath);
                        yield {
                            sourceName: 'aider-vscode',
                            sourceKind: 'aider',
                            filePath,
                            sessionId: `${entry.name}-${file.replace('.aider.', '').replace('.md', '')}`,
                            sizeBytes: stat.size,
                            mtimeMs: stat.mtimeMs,
                        };
                    }
                } catch {
                    /* skip */
                }
            }
        } catch {
            /* skip */
        }
    }
}

registerDiscoverer('aider', () => discoverAiderSessions());
