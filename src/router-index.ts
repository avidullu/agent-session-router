/**
 * Feeder sidecar writer for `archive/.router-index.jsonl` (OUTPUT_CONTRACT §7).
 *
 * Deliberately free of the `vscode` module so it can be unit-tested directly.
 * The hub's `export` merges these records into `archive/index.jsonl`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ExportRecord } from './types';
import { buildRouterIndexRecord, indexIdentityKey } from './contract';

/**
 * Write/merge records into `{outputDir}/.router-index.jsonl`.
 *
 * Existing records are read and de-duplicated by session identity (later wins),
 * so re-running the router keeps the file bounded rather than appending forever.
 * Malformed lines are skipped, mirroring the hub's tolerant JSONL reader.
 */
export function writeRouterIndex(outputDir: string, records: ExportRecord[]): void {
    const indexPath = path.join(outputDir, '.router-index.jsonl');
    const byKey = new Map<string, unknown>();
    const order: string[] = [];
    const upsert = (rec: unknown): void => {
        const key = indexIdentityKey(rec as { source?: string; source_file?: string; metadata?: unknown });
        if (!byKey.has(key)) order.push(key);
        byKey.set(key, rec);
    };

    if (fs.existsSync(indexPath)) {
        for (const line of fs.readFileSync(indexPath, 'utf-8').split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const obj: unknown = JSON.parse(trimmed);
                if (obj && typeof obj === 'object') upsert(obj);
            } catch {
                // Skip malformed lines.
            }
        }
    }

    for (const r of records) {
        upsert(
            buildRouterIndexRecord({
                sourceName: r.sourceName,
                sourceKind: r.sourceKind,
                sourceFilePath: r.filePath,
                digest: r.digest,
                sizeBytes: r.sizeBytes,
                mtimeMs: r.mtimeMs,
                messages: r.messages,
                markdownRel: r.markdownRel,
                metadata: r.metadata,
            }),
        );
    }

    const text = order.map((k) => JSON.stringify(byKey.get(k))).join('\n');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, order.length > 0 ? `${text}\n` : '', 'utf-8');
}
