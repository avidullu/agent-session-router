/**
 * Markdown renderer — byte-for-byte compatible with the Agent Sessions Python
 * `render.py::markdown_for_session` (see the hub's docs/OUTPUT_CONTRACT.md),
 * so the archive pipeline consumes files this extension produces without
 * modification. Conformance is pinned by test/fixtures/contract/.
 *
 * Output format:
 *   # {source_name} / {session_id|source_file_stem}
 *   ## Metadata
 *   - Source: `{source_name}`
 *   - Kind: `{source_kind}`
 *   - Source file: `{native source path}`
 *   - SHA-256: `{digest}`
 *   - Source modified: `{source_modified +00:00}`
 *   - Imported at: `{imported_at +00:00}`
 *   - {every remaining metadata key, sorted}: `{value}`
 *   ## Transcript
 *   ### 1. {role}[ ({timestamp})]
 *   {message text}
 */

import { ExtractedSession } from '../types';
import { isoSecondsNow, pathStem } from '../contract';

export interface RenderContext {
    sourceName: string;
    sourceKind: string;
    sourceFilePath: string;
    digest: string;
    /** UTC ISO-8601 seconds with +00:00 offset (see contract.isoSecondsUtc). */
    sourceModifiedAt: string;
    importedAt?: string;
}

export function renderMarkdown(session: ExtractedSession, ctx: RenderContext): string {
    // Title: source_name / session_id, session_id falling back to the source
    // file stem (NOT a literal), empties dropped — matches render.py.
    const sessionId = String(session.metadata.session_id || pathStem(ctx.sourceFilePath));
    const title = [ctx.sourceName, sessionId].filter((x) => x !== '').join(' / ');
    const importedAt = ctx.importedAt || isoSecondsNow();

    const lines: string[] = [
        `# ${title}`,
        '',
        '## Metadata',
        '',
        `- Source: \`${ctx.sourceName}\``,
        `- Kind: \`${ctx.sourceKind}\``,
        `- Source file: \`${ctx.sourceFilePath}\``,
        `- SHA-256: \`${ctx.digest}\``,
        `- Source modified: \`${ctx.sourceModifiedAt}\``,
        `- Imported at: \`${importedAt}\``,
    ];

    // Every remaining metadata key, sorted, skipping empty values. The contract
    // emits ALL keys (including session_id / source_file) — do not exclude any.
    for (const key of Object.keys(session.metadata).sort()) {
        const value = session.metadata[key];
        if (value === null || value === undefined || value === '') continue;
        lines.push(`- ${key}: \`${String(value)}\``);
    }

    lines.push('', '## Transcript', '');

    if (session.messages.length === 0) {
        lines.push('_No transcript messages were extracted from this file._');
        return lines.join('\n') + '\n';
    }

    for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i];
        let heading = `### ${i + 1}. ${msg.role || 'message'}`;
        if (msg.timestamp) {
            heading += ` (${msg.timestamp})`;
        }
        lines.push(heading, '', msg.text.trimEnd(), '');
    }

    return lines.join('\n').trimEnd() + '\n';
}
