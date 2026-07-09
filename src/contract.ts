/**
 * Canonical Agent Sessions output-contract helpers (format_version 1).
 *
 * These mirror the hub's Python implementation
 * (agent_sessions/{utils,archive,render}.py) so the Markdown, filename stems,
 * and index records this extension writes are byte-for-byte consumable by the
 * `agent-sessions` archive pipeline. The contract is specified in that repo's
 * docs/OUTPUT_CONTRACT.md and pinned by the golden fixtures under
 * test/fixtures/contract/. Change nothing here without updating both.
 */

export const OUTPUT_CONTRACT_VERSION = 1;

/**
 * Strip any of `chars` from both ends of `s` (Python str.strip(chars)).
 */
function stripChars(s: string, chars: string): string {
    let start = 0;
    let end = s.length;
    while (start < end && chars.includes(s[start])) start++;
    while (end > start && chars.includes(s[end - 1])) end--;
    return s.slice(start, end);
}

/**
 * Mirror of agent_sessions.utils.slugify: ASCII `\w`, whitespace → `-`,
 * trimmed of `.-_`, truncated to `maxLen`, lower-cased, empty → "session".
 */
export function contractSlugify(value: string, maxLen = 90): string {
    // re.sub(r"[^\w.\- ]+", "-", value, flags=re.ASCII); \w (ASCII) == [A-Za-z0-9_]
    let v = value.replace(/[^A-Za-z0-9_.\- ]+/g, '-');
    // re.sub(r"\s+", "-", value.strip())
    v = v.trim().replace(/\s+/g, '-');
    v = stripChars(v, '.-_');
    v = stripChars(v.slice(0, maxLen), '.-_');
    return (v || 'session').toLowerCase();
}

/**
 * Mirror of pathlib PurePath.stem: final path segment minus its last suffix.
 */
export function pathStem(p: string): string {
    const base =
        p
            .replace(/[\\/]+$/, '')
            .split(/[\\/]/)
            .pop() || '';
    const dot = base.lastIndexOf('.');
    // A leading-dot-only name (".gitignore") or no dot has no suffix to remove.
    return dot > 0 ? base.slice(0, dot) : base;
}

/** UTC `YYYYMMDD` for an epoch-millis timestamp (archive.py dt_from_timestamp). */
export function yyyymmddUtc(mtimeMs: number): string {
    const d = new Date(mtimeMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
}

/**
 * UTC ISO-8601 truncated to seconds with a `+00:00` offset — matches Python
 * `datetime.isoformat(timespec="seconds")` (NOT the `Z` form).
 */
export function isoSecondsUtc(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function isoSecondsNow(): string {
    return isoSecondsUtc(new Date());
}

/**
 * Archive filename stem: `slugify("{yyyymmdd}-{session_id}-{stem}-{sha[:12]}")`
 * (archive.py export_sources). `session_id` falls back to the source file stem.
 */
export function archiveStem(opts: {
    sourceFilePath: string;
    sessionId: string;
    digest: string;
    mtimeMs: number;
}): string {
    const stem = pathStem(opts.sourceFilePath);
    const sessionId = opts.sessionId || stem;
    return contractSlugify(
        `${yyyymmddUtc(opts.mtimeMs)}-${sessionId}-${stem}-${opts.digest.slice(0, 12)}`,
    );
}

/** Repo-relative POSIX path to an archive markdown file, e.g. `archive/{src}/{stem}.md`. */
export function repoRelativeMarkdown(
    archiveDirName: string,
    sourceName: string,
    stem: string,
): string {
    return [archiveDirName, sourceName, `${stem}.md`].join('/');
}

/** One record of `archive/.router-index.jsonl` (see OUTPUT_CONTRACT.md §6/§7). */
export interface RouterIndexRecord {
    source: string;
    kind: string;
    source_file: string;
    sha256: string;
    size: number;
    /** Epoch **seconds** (float), matching Python `st_mtime`. */
    mtime: number;
    messages: number;
    /** Repo-relative POSIX path. */
    markdown: string;
    metadata: Record<string, unknown>;
}

export function buildRouterIndexRecord(opts: {
    sourceName: string;
    sourceKind: string;
    sourceFilePath: string;
    digest: string;
    sizeBytes: number;
    mtimeMs: number;
    messages: number;
    markdownRel: string;
    metadata: Record<string, unknown>;
}): RouterIndexRecord {
    return {
        source: opts.sourceName,
        kind: opts.sourceKind,
        source_file: opts.sourceFilePath,
        sha256: opts.digest,
        size: opts.sizeBytes,
        mtime: opts.mtimeMs / 1000,
        messages: opts.messages,
        markdown: opts.markdownRel,
        metadata: opts.metadata,
    };
}

/** Merge identity for router index records (archive.py index_identity_key). */
export function indexIdentityKey(record: {
    source?: string;
    source_file?: string;
    sha256?: string;
    metadata?: unknown;
}): string {
    const metadata = record.metadata;
    if (metadata && typeof metadata === 'object') {
        const sid = (metadata as Record<string, unknown>).session_id;
        if (typeof sid === 'string' && sid.trim()) {
            return `session:${sid.trim()}:${record.sha256 ?? ''}`;
        }
    }
    return `path:${record.source ?? ''}:${record.source_file ?? ''}`;
}
