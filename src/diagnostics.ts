/**
 * Diagnostic bundle exporter.
 *
 * Packages all diagnostic data (JSONL log + raw source samples + config)
 * into a portable .zip file for sharing with support or other agents.
 *
 * The bundle is small enough to attach to a GitHub issue or paste into a chat.
 * It never includes full session content — only metadata and error snippets.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getDiagnosticsPath, getDiagnosticsDir } from './logger';
import { getConfig } from './config';

const MAX_SOURCE_SNIPPET_BYTES = 4096; // 4KB max per source file sample

export interface DiagnosticBundle {
    /** Path to the created .zip file */
    zipPath: string;
    /** Summary of what's in the bundle */
    summary: {
        diagnosticsLines: number;
        sourceSamples: number;
        configIncluded: boolean;
        totalSizeBytes: number;
    };
}

/**
 * Create a diagnostic bundle .zip file.
 *
 * The bundle includes:
 *   - diagnostics.jsonl (the full append-only log)
 *   - config.json (current extension configuration, redacted)
 *   - sources/ (up to 10 raw source file snippets, truncated to 4KB each)
 *   - summary.txt (human-readable overview)
 */
export async function createDiagnosticBundle(): Promise<DiagnosticBundle> {
    const config = getConfig();
    const diagPath = getDiagnosticsPath();
    const diagDir = getDiagnosticsDir();
    const outputDir = diagDir || path.join(os.tmpdir(), 'agent-session-router-diagnostics');

    // Ensure output directory
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bundleDir = path.join(outputDir, `diagnostic-bundle-${timestamp}`);
    fs.mkdirSync(bundleDir, { recursive: true });

    // ---- 1. Copy diagnostics JSONL ----
    let diagnosticsLines = 0;
    if (diagPath && fs.existsSync(diagPath)) {
        const content = fs.readFileSync(diagPath, 'utf-8');
        fs.writeFileSync(path.join(bundleDir, 'diagnostics.jsonl'), content, 'utf-8');
        diagnosticsLines = content.split('\n').filter((l) => l.trim()).length;
    }

    // ---- 2. Write redacted config ----
    const redactedConfig = redactConfig(config);
    fs.writeFileSync(
        path.join(bundleDir, 'config.json'),
        JSON.stringify(redactedConfig, null, 2),
        'utf-8',
    );

    // ---- 3. Sample source files from diagnostics ----
    let sourceSamples = 0;
    const sourcesDir = path.join(bundleDir, 'sources');
    fs.mkdirSync(sourcesDir, { recursive: true });

    if (diagPath && fs.existsSync(diagPath)) {
        const lines = fs
            .readFileSync(diagPath, 'utf-8')
            .split('\n')
            .filter((l) => l.trim());
        const errorLines = lines.filter((l) => {
            try {
                return JSON.parse(l).level === 'error';
            } catch {
                return false;
            }
        });

        // Extract source file paths from error entries and sample them
        const sampledPaths = new Set<string>();
        for (const line of errorLines.slice(0, 10)) {
            try {
                const entry = JSON.parse(line);
                if (entry.sourceFile && fs.existsSync(entry.sourceFile)) {
                    if (sampledPaths.has(entry.sourceFile)) continue;
                    sampledPaths.add(entry.sourceFile);

                    const sourceContent = readFileSnippet(
                        entry.sourceFile,
                        MAX_SOURCE_SNIPPET_BYTES,
                    );
                    const safeName = entry.sourceFile.replace(/[<>:"/\\|?*]/g, '_').slice(0, 100);
                    fs.writeFileSync(
                        path.join(sourcesDir, `${safeName}.txt`),
                        sourceContent,
                        'utf-8',
                    );
                    sourceSamples++;
                }
            } catch {
                /* skip malformed entries */
            }
        }
    }

    // ---- 4. Write summary ----
    const totalSizeBytes = getDirectorySize(bundleDir);
    const summary = [
        `Diagnostic Bundle — Agent Session Router`,
        `Generated: ${new Date().toISOString()}`,
        `Extension version: 0.1.0`,
        ``,
        `Contents:`,
        `  diagnostics.jsonl: ${diagnosticsLines} log entries`,
        `  config.json: extension configuration (redacted)`,
        `  sources/: ${sourceSamples} source file snippets from failed extractions`,
        ``,
        `Total bundle size: ${(totalSizeBytes / 1024).toFixed(1)} KB`,
        ``,
        `How to use this bundle:`,
        `  1. Attach to a GitHub issue at https://github.com/avidullu/agent-session-router`,
        `  2. Share with your AI agent for diagnosis`,
        `  3. The JSONL file can be queried with: cat diagnostics.jsonl | jq 'select(.level=="error")'`,
    ].join('\n');
    fs.writeFileSync(path.join(bundleDir, 'summary.txt'), summary, 'utf-8');

    return {
        zipPath: bundleDir, // For now, return directory path (zip compression TBD in future)
        summary: {
            diagnosticsLines,
            sourceSamples,
            configIncluded: true,
            totalSizeBytes,
        },
    };
}

function redactConfig(config: ReturnType<typeof getConfig>): Record<string, unknown> {
    const c = { ...config } as Record<string, unknown>;
    // Redact any potential sensitive paths
    if (typeof c.outputDir === 'string') {
        c.outputDir = c.outputDir.replace(os.homedir(), '~');
    }
    return c;
}

function readFileSnippet(filePath: string, maxBytes: number): string {
    try {
        const stat = fs.statSync(filePath);
        const header = [
            `Source file: ${filePath}`,
            `Size: ${stat.size} bytes`,
            `Modified: ${stat.mtime.toISOString()}`,
            ``,
            `--- First ${maxBytes} bytes ---`,
            ``,
        ].join('\n');

        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(Math.min(maxBytes, stat.size));
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        fs.closeSync(fd);

        return header + buffer.toString('utf-8');
    } catch {
        return `[Could not read: ${filePath}]`;
    }
}

function getDirectorySize(dir: string): number {
    let total = 0;
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isFile()) {
                total += fs.statSync(p).size;
            } else if (entry.isDirectory()) {
                total += getDirectorySize(p);
            }
        }
    } catch {
        /* ignore */
    }
    return total;
}
