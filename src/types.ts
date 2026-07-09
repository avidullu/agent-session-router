/**
 * Shared types for agent session routing.
 */

export interface SessionMessage {
    /** Role: 'user', 'assistant', 'system', 'tool', 'request-prompt' */
    role: string;
    /** Message text content */
    text: string;
    /** ISO-8601 timestamp if available */
    timestamp?: string;
    /** Tool call ID (for tool role messages) */
    toolCallId?: string;
    /** Tool name (for tool role messages) */
    toolName?: string;
}

export interface ExtractedSession {
    /** Arbitrary metadata key-value pairs */
    metadata: Record<string, unknown>;
    /** Ordered list of conversation messages */
    messages: SessionMessage[];
}

export interface DiscoveredSession {
    /** Source name (e.g., "copilot-vscode-windows") */
    sourceName: string;
    /** Source kind (e.g., "copilot_chat") */
    sourceKind: string;
    /** Absolute path to the source file */
    filePath: string;
    /** Unique session identifier */
    sessionId: string;
    /** File size in bytes */
    sizeBytes: number;
    /** Last modified time in milliseconds since epoch */
    mtimeMs: number;
}

/**
 * An extractor function: takes a file path, returns an ExtractedSession.
 */
export type Extractor = (filePath: string) => ExtractedSession;

/**
 * A discoverer function: returns an async iterable of DiscoveredSession.
 */
export type Discoverer = () => AsyncIterable<DiscoveredSession>;

export interface ExportRecord {
    sourceName: string;
    sourceKind: string;
    filePath: string;
    sessionId: string;
    digest: string;
    sizeBytes: number;
    mtimeMs: number;
    /** Absolute path to the written Markdown file. */
    markdownPath: string;
    /** Repo-relative POSIX path, for the .router-index.jsonl `markdown` field. */
    markdownRel: string;
    /** Number of extracted messages. */
    messages: number;
    /** Session metadata carried into the index record. */
    metadata: Record<string, unknown>;
    exportedAt: string;
}
