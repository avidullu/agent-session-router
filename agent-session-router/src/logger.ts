/**
 * Structured logger for the Agent Session Router extension.
 *
 * Writes to two destinations simultaneously:
 *   1. VS Code Output Channel ("Agent Session Router") — human-readable
 *   2. Diagnostic JSONL file ({outputDir}/.router/diagnostics.jsonl) — machine-readable
 *
 * The JSONL file is append-only and designed to be consumed by automated
 * diagnostic tools or shared as a debug artifact.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEntry {
    /** ISO-8601 timestamp */
    timestamp: string;
    /** Log level */
    level: LogLevel;
    /** Operation category (discover, extract, render, write, watcher) */
    category: string;
    /** Human-readable message */
    message: string;
    /** Source agent kind (e.g., 'deepseek_request_dump') */
    sourceKind?: string;
    /** Source file path (relative to machine root) */
    sourceFile?: string;
    /** Session ID */
    sessionId?: string;
    /** Duration in milliseconds */
    durationMs?: number;
    /** File size in bytes */
    sizeBytes?: number;
    /** SHA-256 digest */
    digest?: string;
    /** Number of messages extracted */
    messageCount?: number;
    /** Output file path */
    outputFile?: string;
    /** Error details */
    error?: {
        name: string;
        message: string;
        stack?: string;
        /** First 500 chars of the source file for context */
        sourceSnippet?: string;
    };
    /** Arbitrary extra context */
    extra?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

let _outputChannel: vscode.OutputChannel | undefined;
let _diagnosticsDir: string | undefined;
let _diagnosticsPath: string | undefined;

/** Initialize the logger. Call once during extension activation. */
export function initLogger(diagnosticsDir: string): void {
    _diagnosticsDir = diagnosticsDir;
    _diagnosticsPath = path.join(diagnosticsDir, '.router', 'diagnostics.jsonl');
    _outputChannel = vscode.window.createOutputChannel('Agent Session Router', { log: true });
    _outputChannel.show(true);
}

/** Get the VS Code Output Channel (for use by other modules). */
export function getOutputChannel(): vscode.OutputChannel {
    if (!_outputChannel) {
        _outputChannel = vscode.window.createOutputChannel('Agent Session Router', { log: true });
    }
    return _outputChannel;
}

function ensureDiagnosticsDir(): void {
    if (_diagnosticsPath) {
        const dir = path.dirname(_diagnosticsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

function writeDiagnosticEntry(entry: DiagnosticEntry): void {
    if (!_diagnosticsPath) return;
    ensureDiagnosticsDir();
    try {
        fs.appendFileSync(_diagnosticsPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
        // Silently fail — diagnostics should never break the main pipeline
    }
}

function formatConsoleMessage(entry: DiagnosticEntry): string {
    const parts: string[] = [];
    parts.push(`[${entry.timestamp.slice(11, 19)}]`); // HH:MM:SS
    parts.push(`[${entry.level.toUpperCase().padEnd(5)}]`);
    parts.push(`[${entry.category}]`);
    if (entry.sourceKind) parts.push(`(${entry.sourceKind})`);
    if (entry.sessionId) parts.push(`[${entry.sessionId.slice(0, 8)}]`);
    parts.push(entry.message);
    if (entry.durationMs !== undefined) parts.push(`(${entry.durationMs}ms)`);
    if (entry.error) parts.push(`\n  Error: ${entry.error.name}: ${entry.error.message}`);
    return parts.join(' ');
}

function log(entry: DiagnosticEntry): void {
    const consoleMsg = formatConsoleMessage(entry);

    // VS Code Output Channel
    if (_outputChannel) {
        switch (entry.level) {
            case 'error': _outputChannel.appendLine(consoleMsg); break;
            case 'warn': _outputChannel.appendLine(consoleMsg); break;
            case 'info': _outputChannel.appendLine(consoleMsg); break;
            case 'debug': _outputChannel.appendLine(consoleMsg); break;
        }
    }

    // Diagnostic JSONL (always append)
    writeDiagnosticEntry(entry);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function logDiscover(
    sourceKind: string,
    sourceFile: string,
    sessionId: string,
    extra?: Record<string, unknown>,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'debug',
        category: 'discover',
        sourceKind,
        sourceFile,
        sessionId,
        message: `Discovered session file`,
        extra,
    });
}

export function logExtractStart(
    sourceKind: string,
    sourceFile: string,
    sessionId: string,
    sizeBytes: number,
): () => void {
    const start = Date.now();
    log({
        timestamp: new Date().toISOString(),
        level: 'debug',
        category: 'extract',
        sourceKind,
        sourceFile,
        sessionId,
        sizeBytes,
        message: `Starting extraction`,
    });
    return () => {
        const durationMs = Date.now() - start;
        log({
            timestamp: new Date().toISOString(),
            level: 'debug',
            category: 'extract',
            sourceKind,
            sourceFile,
            sessionId,
            durationMs,
            message: `Extraction complete`,
        });
    };
}

export function logExtractResult(
    sourceKind: string,
    sourceFile: string,
    sessionId: string,
    messageCount: number,
    durationMs: number,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'info',
        category: 'extract',
        sourceKind,
        sourceFile,
        sessionId,
        messageCount,
        durationMs,
        message: `Extracted ${messageCount} messages`,
    });
}

export function logExtractError(
    sourceKind: string,
    sourceFile: string,
    sessionId: string,
    error: Error,
    sourceSnippet?: string,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'error',
        category: 'extract',
        sourceKind,
        sourceFile,
        sessionId,
        message: `Extraction failed`,
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            sourceSnippet,
        },
    });
}

export function logRender(
    sourceKind: string,
    sessionId: string,
    outputFile: string,
    messageCount: number,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'info',
        category: 'render',
        sourceKind,
        sessionId,
        outputFile,
        messageCount,
        message: `Rendered Markdown`,
    });
}

export function logWrite(
    sourceKind: string,
    sessionId: string,
    outputFile: string,
    sizeBytes: number,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'info',
        category: 'write',
        sourceKind,
        sessionId,
        outputFile,
        sizeBytes,
        message: `Wrote output file`,
    });
}

export function logWriteError(
    sourceKind: string,
    sessionId: string,
    outputFile: string,
    error: Error,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'error',
        category: 'write',
        sourceKind,
        sessionId,
        outputFile,
        message: `Write failed`,
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
        },
    });
}

export function logSkip(
    sourceKind: string,
    sourceFile: string,
    sessionId: string,
    reason: string,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'debug',
        category: 'skip',
        sourceKind,
        sourceFile,
        sessionId,
        message: `Skipped: ${reason}`,
    });
}

export function logExportSummary(
    total: number,
    exported: number,
    skipped: number,
    failed: number,
    durationMs: number,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'info',
        category: 'summary',
        message: `Export complete: ${exported} exported, ${skipped} skipped, ${failed} failed out of ${total} total`,
        durationMs,
        extra: { total, exported, skipped, failed },
    });
}

export function logWatcherEvent(
    event: 'start' | 'stop' | 'change' | 'create' | 'error',
    filePath?: string,
    extra?: Record<string, unknown>,
): void {
    log({
        timestamp: new Date().toISOString(),
        level: 'info',
        category: 'watcher',
        sourceFile: filePath,
        message: `Watcher ${event}${filePath ? `: ${filePath}` : ''}`,
        extra,
    });
}

/** Get the path to the diagnostics JSONL file. */
export function getDiagnosticsPath(): string | undefined {
    return _diagnosticsPath;
}

/** Get the diagnostics directory. */
export function getDiagnosticsDir(): string | undefined {
    return _diagnosticsDir;
}
