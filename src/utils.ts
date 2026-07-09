/**
 * Shared utilities: hashing, path resolution, timestamps.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StringDecoder } from 'string_decoder';

const FILE_READ_CHUNK_BYTES = 1024 * 1024;

/** Compute SHA-256 hex digest of a file. */
export function sha256File(filePath: string): string {
    const h = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.allocUnsafe(FILE_READ_CHUNK_BYTES);
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (bytesRead > 0) {
                h.update(buffer.subarray(0, bytesRead));
            }
        } while (bytesRead > 0);
    } finally {
        fs.closeSync(fd);
    }
    return h.digest('hex');
}

/** Iterate a UTF-8 text file line-by-line without loading the whole file. */
export function forEachTextLine(filePath: string, onLine: (line: string) => void): void {
    const fd = fs.openSync(filePath, 'r');
    const decoder = new StringDecoder('utf8');
    let carry = '';

    try {
        const buffer = Buffer.allocUnsafe(FILE_READ_CHUNK_BYTES);
        let bytesRead = 0;
        do {
            bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (bytesRead <= 0) continue;

            const text = carry + decoder.write(buffer.subarray(0, bytesRead));
            const lines = text.split(/\r?\n/);
            carry = lines.pop() ?? '';
            for (const line of lines) {
                onLine(line);
            }
        } while (bytesRead > 0);

        const finalText = carry + decoder.end();
        if (finalText.length > 0) {
            onLine(finalText);
        }
    } finally {
        fs.closeSync(fd);
    }
}

/** Get file stat (size + mtime). */
export function fileStat(filePath: string): { size: number; mtimeMs: number } {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
}

/** Resolve a path that may contain ~ or environment variables. */
export function resolvePath(raw: string): string {
    let resolved = raw;
    if (resolved.startsWith('~')) {
        resolved = path.join(os.homedir(), resolved.slice(1));
    }
    // Expand %VAR% style on Windows
    resolved = resolved.replace(/%([^%]+)%/g, (_match, name) => process.env[name] || '');
    return path.resolve(resolved);
}

/** Generate an ISO-8601 UTC timestamp string. */
export function isoNow(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Sanitize a string for use as a filename segment. */
export function slugify(text: string): string {
    return text
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/\s+/g, '-')
        .slice(0, 200);
}

/** Convert a Windows file path to a POSIX-style relative path. */
export function toPosixPath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Check whether a cached export record is still valid
 * (same file size and mtime as when last exported).
 */
export function canReuseRecord(
    prior: { sizeBytes: number; mtimeMs: number } | undefined,
    currentSize: number,
    currentMtimeMs: number,
): boolean {
    if (!prior) return false;
    return prior.sizeBytes === currentSize && prior.mtimeMs === currentMtimeMs;
}
