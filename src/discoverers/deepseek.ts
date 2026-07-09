/**
 * DeepSeek V4 session discoverer.
 *
 * Scans VS Code globalStorage for DeepSeek request-dump directories.
 * Each directory = one session, containing JSON request/response files.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

const DEEPSEEK_EXTENSION_ID = 'vizards.deepseek-v4-for-copilot';

function getDeepSeekStorageRoots(): string[] {
    const roots: string[] = [];

    // Windows: %APPDATA%/Code/User/globalStorage/{extensionId}/request-dumps
    const appData = process.env.APPDATA;
    if (appData) {
        roots.push(
            path.join(
                appData,
                'Code',
                'User',
                'globalStorage',
                DEEPSEEK_EXTENSION_ID,
                'request-dumps',
            ),
        );
    }

    // Linux/macOS: ~/.config/Code/User/globalStorage/{extensionId}/request-dumps
    const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    roots.push(
        path.join(
            configDir,
            'Code',
            'User',
            'globalStorage',
            DEEPSEEK_EXTENSION_ID,
            'request-dumps',
        ),
    );

    // macOS alternative
    roots.push(
        path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'Code',
            'User',
            'globalStorage',
            DEEPSEEK_EXTENSION_ID,
            'request-dumps',
        ),
    );

    return roots;
}

async function* discoverDeepSeekSessions(): AsyncIterable<DiscoveredSession> {
    for (const root of getDeepSeekStorageRoots()) {
        if (!fs.existsSync(root)) {
            continue;
        }
        const entries = fs.readdirSync(root, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const sessionDir = path.join(root, entry.name);
            const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith('.json'));
            if (files.length === 0) continue;

            // Use the first JSON file as the canonical source file
            const canonicalFile = files.find((f) => f.includes('input')) || files[0];
            const filePath = path.join(sessionDir, canonicalFile);
            const stat = fs.statSync(filePath);

            yield {
                sourceName: 'deepseek-vscode',
                sourceKind: 'deepseek_request_dump',
                filePath,
                sessionId: entry.name,
                sizeBytes: stat.size,
                mtimeMs: stat.mtimeMs,
            };
        }
    }
}

registerDiscoverer('deepseek_request_dump', () => discoverDeepSeekSessions());
