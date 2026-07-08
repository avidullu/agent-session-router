/**
 * Markdown renderer — produces output compatible with the Agent Sessions
 * Python render.py format so the archive pipeline can consume files
 * produced by this extension without modification.
 *
 * Output format:
 *   # {source_name} / {session_id}
 *   ## Metadata
 *   - Source: `{source_name}`
 *   - Kind: `{source_kind}`
 *   - Source file: `{filePath}`
 *   - SHA-256: `{digest}`
 *   - Source modified: `{mtime_iso}`
 *   - Imported at: `{imported_at}`
 *   ## Transcript
 *   ### 1. {role} ({timestamp})
 *   {message text}
 */

import { ExtractedSession } from '../types';
import { isoNow, toPosixPath } from '../utils';

export interface RenderContext {
    sourceName: string;
    sourceKind: string;
    sourceFilePath: string;
    digest: string;
    sourceModifiedAt: string;
    importedAt?: string;
}

export function renderMarkdown(session: ExtractedSession, ctx: RenderContext): string {
    const title = `${ctx.sourceName} / ${session.metadata.session_id || 'unknown'}`;
    const importedAt = ctx.importedAt || isoNow();

    const lines: string[] = [
        `# ${title}`,
        '',
        '## Metadata',
        '',
        `- Source: \`${ctx.sourceName}\``,
        `- Kind: \`${ctx.sourceKind}\``,
        `- Source file: \`${toPosixPath(ctx.sourceFilePath)}\``,
        `- SHA-256: \`${ctx.digest}\``,
        `- Source modified: \`${ctx.sourceModifiedAt}\``,
        `- Imported at: \`${importedAt}\``,
    ];

    // Emit extra metadata keys
    for (const key of Object.keys(session.metadata).sort()) {
        const value = session.metadata[key];
        if (value === null || value === undefined || value === '') continue;
        if (key === 'session_id' || key === 'source_file') continue; // already covered
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
        if (msg.toolName) {
            heading += ` [tool: ${msg.toolName}]`;
        }
        lines.push(heading, '', msg.text.trimEnd(), '');
    }

    return lines.join('\n').trimEnd() + '\n';
}
