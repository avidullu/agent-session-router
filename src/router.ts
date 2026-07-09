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
import { sha256File, isoNow, canReuseRecord } from './utils';
import { archiveStem, isoSecondsUtc, repoRelativeMarkdown } from './contract';
import { writeRouterIndex } from './router-index';
import { getConfig, Config } from './config';
import {
    logDiscover,
    logExtractStart,
    logExtractResult,
    logExtractError,
    logRender,
    logWrite,
    logWriteError,
    logSkip,
    logExportSummary,
} from './logger';

// Auto-load all discoverers and extractors from their directories.
// Users add new agents by dropping files into these folders — no core edits needed.
function autoLoadModules(dir: string): void {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) return;
    for (const file of fs.readdirSync(dirPath)) {
        if (!file.endsWith('.js') || file === 'index.js') continue;
        try {
            require(path.join(dirPath, file));
        } catch (err) {
            // Per-file error: one broken plugin must not disable all others.
            // Built-in modules (copilot-chat, deepseek) failing is still a
            // diagnosable error visible in the Output Channel.
            const error = err instanceof Error ? err : new Error(String(err));
            logExtractError('autoLoad', path.join(dirPath, file), dir, error);
            console.error(
                `[agent-session-router] Failed to load ${dir}/${file}: ${error.message}. ` +
                    `This agent source will be unavailable. Check the Output Channel for details.`,
            );
        }
    }
}
autoLoadModules('discoverers');
autoLoadModules('extractors');

/** In-memory cache of previous export records (keyed by filePath). */
const exportCache = new Map<string, ExportRecord>();

export function resetExportCache(): void {
    exportCache.clear();
}

export function resolveOutputDir(config: Config): string {
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

    // Discover all registered kinds that are enabled in config.
    // Users add new agents by registering a discoverer — config automatically picks it up.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { knownKinds } = require('./discoverers/index') as { knownKinds: () => string[] };
    const kindsToDiscover = knownKinds().filter((kind) => config.sources[kind]?.enabled !== false);

    for (const kind of kindsToDiscover) {
        const discoverer = getDiscoverer(kind);
        if (!discoverer) continue;

        progress.report({ message: `Discovering ${kind} sessions...` });

        for await (const session of discoverer()) {
            logDiscover(session.sourceKind, session.filePath, session.sessionId, {
                sizeBytes: session.sizeBytes,
                mtimeMs: session.mtimeMs,
            });
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
        logSkip(
            session.sourceKind,
            session.filePath,
            session.sessionId,
            `No extractor registered for kind: ${session.sourceKind}`,
        );
        return null;
    }

    // Check cache for unchanged files
    const cached = exportCache.get(session.filePath) ?? null;
    if (cached && canReuseRecord(cached, session.sizeBytes, session.mtimeMs)) {
        logSkip(
            session.sourceKind,
            session.filePath,
            session.sessionId,
            'Unchanged since last export (cached)',
        );
        return cached;
    }

    // Extract
    const extractDone = logExtractStart(
        session.sourceKind,
        session.filePath,
        session.sessionId,
        session.sizeBytes,
    );
    let extracted;
    try {
        extracted = extractor(session.filePath);
    } catch (err) {
        extractDone();
        const error = err instanceof Error ? err : new Error(String(err));
        let snippet: string | undefined;
        try {
            snippet = fs.readFileSync(session.filePath, 'utf-8').slice(0, 500);
        } catch {
            /* file may not be readable */
        }
        logExtractError(session.sourceKind, session.filePath, session.sessionId, error, snippet);
        return null;
    }
    extractDone();

    if (!extracted.messages.length) {
        logSkip(
            session.sourceKind,
            session.filePath,
            session.sessionId,
            'No messages extracted (empty session)',
        );
        return null;
    }

    logExtractResult(
        session.sourceKind,
        session.filePath,
        session.sessionId,
        extracted.messages.length,
        0,
    );

    // Compute digest
    let digest: string;
    try {
        digest = sha256File(session.filePath);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logExtractError(session.sourceKind, session.filePath, session.sessionId, error);
        return null;
    }

    // Determine output path — archive/{source_name}/{stem}.md, where the stem
    // matches the hub's naming (contract.archiveStem / OUTPUT_CONTRACT.md §5).
    const stem = archiveStem({
        sourceFilePath: session.filePath,
        sessionId: String(extracted.metadata.session_id || ''),
        digest,
        mtimeMs: session.mtimeMs,
    });
    const archiveDirName = path.basename(outputDir);
    const markdownPath = path.join(outputDir, session.sourceName, `${stem}.md`);
    const markdownRel = repoRelativeMarkdown(archiveDirName, session.sourceName, stem);

    // Render
    const markdown = renderMarkdown(extracted, {
        sourceName: session.sourceName,
        sourceKind: session.sourceKind,
        sourceFilePath: session.filePath,
        digest,
        sourceModifiedAt: isoSecondsUtc(new Date(session.mtimeMs)),
    });

    logRender(session.sourceKind, session.sessionId, markdownPath, extracted.messages.length);

    // Write
    const dir = path.dirname(markdownPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    try {
        fs.writeFileSync(markdownPath, markdown, 'utf-8');
        logWrite(
            session.sourceKind,
            session.sessionId,
            markdownPath,
            Buffer.byteLength(markdown, 'utf-8'),
        );
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logWriteError(session.sourceKind, session.sessionId, markdownPath, error);
        return null;
    }

    const record: ExportRecord = {
        sourceName: session.sourceName,
        sourceKind: session.sourceKind,
        filePath: session.filePath,
        sessionId: session.sessionId,
        digest,
        sizeBytes: session.sizeBytes,
        mtimeMs: session.mtimeMs,
        markdownPath,
        markdownRel,
        messages: extracted.messages.length,
        metadata: extracted.metadata,
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
    let exported = 0;
    const skipped = 0;
    let failed = 0;
    const startTime = Date.now();

    for (const session of sessions) {
        progress.report({
            message: `Exporting ${completed + 1}/${total}: ${session.sourceName}`,
            increment: 100 / total,
        });

        const record = await exportSession(session, outputDir);
        if (record) {
            records.push(record);
            exported++;
        } else {
            // Check if it was skipped (cached) or failed
            // The logger already recorded the reason
            failed++;
        }
        completed++;
    }

    const durationMs = Date.now() - startTime;
    logExportSummary(total, exported, skipped, failed, durationMs);

    if (records.length > 0) {
        writeRouterIndex(outputDir, records);
    }

    return records;
}
