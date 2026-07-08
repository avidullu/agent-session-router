/**
 * Router orchestrator — the central pipeline:
 *   1. Discover sessions from configured sources
 *   2. Extract structured messages via registered extractors
 *   3. Render Markdown
 *   4. Write output files to the configured directory
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiscoveredSession, ExportRecord } from './types';
import { getDiscoverer } from './discoverers/index';
import { getExtractor } from './extractors/index';
import { renderMarkdown } from './renderers/markdown';
import { sha256File, slugify, isoNow, canReuseRecord } from './utils';
import { getConfig, Config } from './config';

// Import discoverers and extractors to trigger registration side-effects
import './discoverers/deepseek';
import './discoverers/copilot-chat';
import './extractors/deepseek';
import './extractors/copilot-chat';

/** In-memory cache of previous export records (keyed by filePath). */
const exportCache = new Map<string, ExportRecord>();

function resolveOutputDir(config: Config): string {
    if (config.outputDir) {
        return config.outputDir;
    }
    // Default: try to find Agent Sessions repo relative to common locations
    const candidates = [
        path.join(process.env.USERPROFILE || '~', 'Projects', 'Agent Sessions', 'archive'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    // Fallback to a local staging directory
    return path.join(process.env.USERPROFILE || '~', '.agent-sessions-staging');
}

export async function discoverAllSessions(
    progress: vscode.Progress<{ message?: string }>,
): Promise<DiscoveredSession[]> {
    const config = getConfig();
    const allSessions: DiscoveredSession[] = [];

    const kindsToDiscover: string[] = [];
    if (config.sources.deepseek.enabled) kindsToDiscover.push('deepseek_request_dump');
    if (config.sources.copilotChat.enabled) kindsToDiscover.push('copilot_chat');

    for (const kind of kindsToDiscover) {
        const discoverer = getDiscoverer(kind);
        if (!discoverer) continue;

        progress.report({ message: `Discovering ${kind} sessions...` });

        for await (const session of discoverer()) {
            allSessions.push(session);
        }
    }

    return allSessions;
}

export async function exportSession(
    session: DiscoveredSession,
    outputDir: string,
): Promise<ExportRecord | null> {
    const extractor = getExtractor(session.sourceKind);
    if (!extractor) {
        console.warn(`[agent-session-router] No extractor for kind: ${session.sourceKind}`);
        return null;
    }

    // Check cache for unchanged files
    const cached = exportCache.get(session.filePath) ?? null;
    if (cached && canReuseRecord(cached, session.sizeBytes, session.mtimeMs)) {
        return cached;
    }

    // Extract
    const extracted = extractor(session.filePath);
    if (!extracted.messages.length) {
        console.warn(`[agent-session-router] No messages extracted from: ${session.filePath}`);
        return null;
    }

    // Compute digest
    const digest = sha256File(session.filePath);

    // Determine output path
    const sourceDir = slugify(session.sourceName);
    const sessionFile = slugify(String(extracted.metadata.session_id || path.basename(session.filePath, path.extname(session.filePath))));
    const markdownPath = path.join(outputDir, sourceDir, `${sessionFile}.md`);

    // Render
    const modifiedDate = new Date(session.mtimeMs);
    const markdown = renderMarkdown(extracted, {
        sourceName: session.sourceName,
        sourceKind: session.sourceKind,
        sourceFilePath: session.filePath,
        digest,
        sourceModifiedAt: modifiedDate.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    });

    // Write
    const dir = path.dirname(markdownPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(markdownPath, markdown, 'utf-8');

    const record: ExportRecord = {
        sourceName: session.sourceName,
        sourceKind: session.sourceKind,
        filePath: session.filePath,
        sessionId: session.sessionId,
        digest,
        sizeBytes: session.sizeBytes,
        mtimeMs: session.mtimeMs,
        markdownPath,
        exportedAt: isoNow(),
    };

    exportCache.set(session.filePath, record);
    return record;
}

export async function exportAllSessions(
    progress: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<ExportRecord[]> {
    const config = getConfig();
    const outputDir = resolveOutputDir(config);

    progress.report({ message: 'Discovering sessions...' });
    const sessions = await discoverAllSessions(progress);

    if (sessions.length === 0) {
        vscode.window.showInformationMessage('Agent Session Router: No sessions found to export.');
        return [];
    }

    const records: ExportRecord[] = [];
    const total = sessions.length;
    let completed = 0;

    for (const session of sessions) {
        progress.report({
            message: `Exporting ${completed + 1}/${total}: ${session.sourceName}`,
            increment: (100 / total),
        });

        const record = await exportSession(session, outputDir);
        if (record) {
            records.push(record);
        }
        completed++;
    }

    return records;
}
