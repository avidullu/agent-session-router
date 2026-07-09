/**
 * Gemini Antigravity session discoverer.
 *
 * Scans ~/.gemini/antigravity/brain/ and ~/.gemini/antigravity-ide/brain/
 * for Gemini Antigravity VS Code extension transcript files.
 *
 * Each session is a UUID-named directory containing:
 *   .system_generated/logs/transcript.jsonl   (antigravity)
 *   .system_generated/logs/overview.txt        (antigravity-ide, also JSONL)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DiscoveredSession } from '../types';
import { registerDiscoverer } from './index';

const BRAIN_ROOTS = [
    path.join(os.homedir(), '.gemini', 'antigravity', 'brain'),
    path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain'),
];

const TRANSCRIPT_CANDIDATES = [
    path.join('.system_generated', 'logs', 'transcript.jsonl'),
    path.join('.system_generated', 'logs', 'overview.txt'),
];

function findTranscriptFile(sessionDir: string): string | null {
    for (const candidate of TRANSCRIPT_CANDIDATES) {
        const fullPath = path.join(sessionDir, candidate);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}

async function* discoverGeminiAntigravitySessions(): AsyncIterable<DiscoveredSession> {
    for (const brainRoot of BRAIN_ROOTS) {
        if (!fs.existsSync(brainRoot)) continue;

        let sessionDirs: fs.Dirent[];
        try {
            sessionDirs = fs.readdirSync(brainRoot, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const sessionDir of sessionDirs) {
            if (!sessionDir.isDirectory()) continue;

            const sessionPath = path.join(brainRoot, sessionDir.name);
            const transcriptFile = findTranscriptFile(sessionPath);
            if (!transcriptFile) continue;

            let stat: fs.Stats;
            try {
                stat = fs.statSync(transcriptFile);
            } catch {
                continue;
            }

            // Skip empty transcripts
            if (stat.size === 0) continue;

            // Determine which variant this is for the source name
            const isIde = brainRoot.includes('antigravity-ide');
            const sourceName = isIde
                ? 'gemini-antigravity-ide-windows'
                : 'gemini-antigravity-windows';

            yield {
                sourceName,
                sourceKind: 'gemini_antigravity',
                filePath: transcriptFile,
                sessionId: sessionDir.name,
                sizeBytes: stat.size,
                mtimeMs: stat.mtimeMs,
            };
        }
    }
}

registerDiscoverer('gemini_antigravity', () => discoverGeminiAntigravitySessions());
