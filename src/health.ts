/** Read-only metadata health; never loads transcript bodies or runs the hub. */
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './config';
import { indexIdentityKey } from './contract';

const issues = new Map<string, Map<string, string>>();

export function recordCollectionIssue(outputDir: string, key: string, code: string): void {
    const bucket = issues.get(outputDir) ?? new Map<string, string>();
    bucket.set(key, `${new Date().toISOString()} — ${code}`);
    issues.set(outputDir, bucket);
}

export function clearCollectionIssue(outputDir: string, key: string): void {
    issues.get(outputDir)?.delete(key);
}

export function collectionHealth(
    outputDir: string,
    config: Config,
    running: boolean,
    kinds: string[],
): Record<string, unknown> {
    const problems: string[] = [];
    const records = new Map<string, Record<string, unknown>>();
    let indexState = 'missing';
    const index = path.join(outputDir, '.router-index.jsonl');
    if (fs.existsSync(index)) {
        try {
            indexState = 'readable';
            for (const line of fs.readFileSync(index, 'utf8').split('\n')) {
                if (!line.trim()) continue;
                try {
                    const record = JSON.parse(line);
                    if (
                        !record ||
                        typeof record !== 'object' ||
                        typeof record.source !== 'string' ||
                        typeof record.source_file !== 'string'
                    ) {
                        throw new Error('invalid record');
                    }
                    records.set(indexIdentityKey(record), record);
                } catch {
                    indexState = 'malformed';
                }
            }
        } catch {
            indexState = 'unreadable';
        }
    }
    if (indexState === 'malformed' || indexState === 'unreadable')
        problems.push(`Router index ${indexState}; counts may be incomplete.`);
    let messages = 0;
    let unknownMessages = 0;
    let markdownBytes = 0;
    let missingArtifacts = 0;
    let lastSuccess: string | null = null;
    const sourceCounts: Record<string, number> = {};
    for (const record of records.values()) {
        if (Number.isSafeInteger(record.messages) && Number(record.messages) >= 0)
            messages += Number(record.messages);
        else unknownMessages++;
        const source = String(record.source);
        sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
        const timestamp = record.exported_at;
        if (
            typeof timestamp === 'string' &&
            /(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) &&
            Number.isFinite(Date.parse(timestamp))
        ) {
            const normalized = new Date(timestamp).toISOString();
            if (!lastSuccess || normalized > lastSuccess) lastSuccess = normalized;
        }
        try {
            if (typeof record.markdown !== 'string' || !record.markdown)
                throw new Error('missing artifact');
            const artifact = fs.realpathSync(
                path.resolve(path.dirname(outputDir), record.markdown.replace(/\\/g, '/')),
            );
            const root = fs.realpathSync(outputDir);
            const relative = path.relative(root, artifact);
            if (
                relative.startsWith(`..${path.sep}`) ||
                relative === '..' ||
                path.isAbsolute(relative)
            )
                throw new Error('outside archive');
            const stat = fs.statSync(artifact);
            if (!stat.isFile()) throw new Error('not a file');
            markdownBytes += stat.size;
        } catch {
            missingArtifacts++;
        }
    }
    if (missingArtifacts)
        problems.push(
            `${missingArtifacts} catalogued Markdown artifacts are missing or outside this archive.`,
        );
    const runtimeIssues = [...(issues.get(outputDir)?.values() ?? [])];
    return {
        archiveDirectory: outputDir,
        collectionState:
            problems.length || runtimeIssues.length
                ? 'attention_required'
                : records.size
                  ? 'collected'
                  : 'no_sessions',
        watcherState: !config.enabled
            ? 'extension_disabled'
            : !config.watch.enabled
              ? 'manual_only'
              : running
                ? 'watching'
                : 'not_running',
        sources: Object.fromEntries(
            [...new Set([...kinds, ...Object.keys(config.sources)])].map((kind) => [
                kind,
                config.sources[kind]?.enabled === false
                    ? 'disabled'
                    : kinds.includes(kind)
                      ? 'enabled'
                      : 'unregistered',
            ]),
        ),
        routerIndex: indexState,
        sessions: indexState === 'unreadable' ? null : records.size,
        knownMessages: indexState === 'unreadable' ? null : messages,
        sessionsWithUnknownMessageCount: unknownMessages,
        localMarkdownBytes: markdownBytes,
        lastSuccessfulExport: lastSuccess,
        sourceCounts,
        problems,
        unresolvedErrorsThisActivation: runtimeIssues,
        note: 'This reports router-owned sessions only. Legacy export times are unknown. Error history starts at activation; watcher errors clear on restart, export errors after a successful retry. Match the hub archive_dir to archiveDirectory. Auto-export is opt-in.',
    };
}
