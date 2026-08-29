/**
 * Read the current GitHub Copilot Chat session store.
 *
 * Copilot Chat moved its durable sessions from per-workspace JSONL files to a
 * WAL-backed SQLite database in globalStorage.  Node's built-in SQLite binding
 * opens the live database read-only, so SQLite—not this extension—owns WAL
 * visibility and snapshot consistency.
 */

import * as crypto from 'crypto';
import { ExtractedSession, SessionMessage } from './types';

type SqliteValue = string | number | bigint | Uint8Array | null;
type SqliteRow = Record<string, SqliteValue>;

interface SqliteStatement {
    all(...params: SqliteValue[]): SqliteRow[];
    get(...params: SqliteValue[]): SqliteRow | undefined;
}

interface SqliteDatabase {
    close(): void;
    prepare(sql: string): SqliteStatement;
}

interface SqliteDatabaseConstructor {
    new (path: string, options?: { readOnly?: boolean }): SqliteDatabase;
}

interface SessionRow extends SqliteRow {
    id: string;
    cwd: string | null;
    repository: string | null;
    host_type: string | null;
    branch: string | null;
    summary: string | null;
    agent_name: string | null;
    agent_description: string | null;
    created_at: string | null;
    updated_at: string | null;
}

interface TurnRow extends SqliteRow {
    turn_index: number;
    user_message: string | null;
    assistant_response: string | null;
    timestamp: string | null;
}

export interface CopilotStoreSessionSummary {
    sessionId: string;
    revision: string;
    messageCount: number;
}

const REQUIRED_SESSION_COLUMNS = [
    'id',
    'cwd',
    'repository',
    'host_type',
    'branch',
    'summary',
    'agent_name',
    'agent_description',
    'created_at',
    'updated_at',
];

const REQUIRED_TURN_COLUMNS = [
    'session_id',
    'turn_index',
    'user_message',
    'assistant_response',
    'timestamp',
];

function loadDatabaseConstructor(): SqliteDatabaseConstructor {
    try {
        // Kept dynamic so legacy JSONL support still loads on Node runtimes
        // older than 22.5. SQLite-store discovery is simply unavailable there.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const sqlite = require('node:sqlite') as { DatabaseSync?: SqliteDatabaseConstructor };
        if (sqlite.DatabaseSync) return sqlite.DatabaseSync;
    } catch {
        // The actionable error below is shared by discovery and extraction.
    }
    throw new Error(
        'Copilot session-store.db requires a VS Code extension host with node:sqlite ' +
            '(Node.js 22.5 or newer). Legacy Copilot JSONL sessions remain supported.',
    );
}

function withReadOnlyDatabase<T>(filePath: string, fn: (db: SqliteDatabase) => T): T {
    const DatabaseSync = loadDatabaseConstructor();
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
        return fn(db);
    } finally {
        db.close();
    }
}

function text(value: SqliteValue | undefined): string | null {
    return typeof value === 'string' ? value : null;
}

function number(value: SqliteValue | undefined): number {
    return typeof value === 'number' ? value : Number(value ?? 0);
}

function tableColumns(db: SqliteDatabase, table: string): Set<string> {
    return new Set(
        db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((row) => text(row.name))
            .filter((name): name is string => Boolean(name)),
    );
}

function requireColumns(db: SqliteDatabase, table: string, required: string[]): void {
    const present = tableColumns(db, table);
    const missing = required.filter((column) => !present.has(column));
    if (missing.length > 0) {
        throw new Error(
            `Unsupported Copilot session store: ${table} is missing ${missing.join(', ')}`,
        );
    }
}

function readSchemaVersion(db: SqliteDatabase): number {
    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get();
    const version = number(row?.version);
    if (!Number.isInteger(version) || version < 1) {
        throw new Error(`Unsupported Copilot session store schema version: ${version}`);
    }
    return version;
}

function validateSchema(db: SqliteDatabase): number {
    requireColumns(db, 'sessions', REQUIRED_SESSION_COLUMNS);
    requireColumns(db, 'turns', REQUIRED_TURN_COLUMNS);
    return readSchemaVersion(db);
}

function readSessionRow(db: SqliteDatabase, sessionId: string): SessionRow {
    const row = db
        .prepare(
            `SELECT id, cwd, repository, host_type, branch, summary,
                    agent_name, agent_description, created_at, updated_at
             FROM sessions
             WHERE id = ?`,
        )
        .get(sessionId);
    if (!row) throw new Error(`Copilot session not found in session-store.db: ${sessionId}`);

    return {
        id: text(row.id) ?? sessionId,
        cwd: text(row.cwd),
        repository: text(row.repository),
        host_type: text(row.host_type),
        branch: text(row.branch),
        summary: text(row.summary),
        agent_name: text(row.agent_name),
        agent_description: text(row.agent_description),
        created_at: text(row.created_at),
        updated_at: text(row.updated_at),
    };
}

function readTurnRows(db: SqliteDatabase, sessionId: string): TurnRow[] {
    return db
        .prepare(
            `SELECT turn_index, user_message, assistant_response, timestamp
             FROM turns
             WHERE session_id = ?
             ORDER BY turn_index ASC, id ASC`,
        )
        .all(sessionId)
        .map((row) => ({
            turn_index: number(row.turn_index),
            user_message: text(row.user_message),
            assistant_response: text(row.assistant_response),
            timestamp: text(row.timestamp),
        }));
}

function sessionDigest(session: SessionRow, turns: TurnRow[]): string {
    const canonical = JSON.stringify({ session, turns });
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

function appendMetadata(
    metadata: Record<string, unknown>,
    key: string,
    value: string | null,
): void {
    if (value && value.trim()) metadata[key] = value;
}

function toMessages(turns: TurnRow[]): SessionMessage[] {
    const messages: SessionMessage[] = [];
    for (const turn of turns) {
        if (turn.user_message?.trim()) {
            messages.push({
                role: 'user',
                text: turn.user_message.trim(),
                timestamp: turn.timestamp ?? undefined,
            });
        }
        if (turn.assistant_response?.trim()) {
            messages.push({
                role: 'assistant',
                text: turn.assistant_response.trim(),
                timestamp: turn.timestamp ?? undefined,
            });
        }
    }
    return messages;
}

function readSession(db: SqliteDatabase, sessionId: string): ExtractedSession {
    const schemaVersion = validateSchema(db);
    const session = readSessionRow(db, sessionId);
    const turns = readTurnRows(db, sessionId);
    const digest = sessionDigest(session, turns);
    const metadata: Record<string, unknown> = {
        session_id: session.id,
        source_format: 'copilot_session_store',
        source_schema_version: schemaVersion,
        source_revision: digest,
    };

    appendMetadata(metadata, 'cwd', session.cwd);
    appendMetadata(metadata, 'repository', session.repository);
    appendMetadata(metadata, 'host_type', session.host_type);
    appendMetadata(metadata, 'branch', session.branch);
    appendMetadata(metadata, 'summary', session.summary);
    appendMetadata(metadata, 'agent_name', session.agent_name);
    appendMetadata(metadata, 'agent_description', session.agent_description);
    appendMetadata(metadata, 'created_at', session.created_at);
    appendMetadata(metadata, 'updated_at', session.updated_at);

    return { metadata, messages: toMessages(turns), sourceDigest: digest };
}

export function listCopilotStoreSessions(filePath: string): CopilotStoreSessionSummary[] {
    return withReadOnlyDatabase(filePath, (db) => {
        validateSchema(db);
        const sessionIds = db
            .prepare('SELECT id FROM sessions ORDER BY created_at ASC, id ASC')
            .all()
            .map((row) => text(row.id))
            .filter((sessionId): sessionId is string => Boolean(sessionId));

        return sessionIds.map((sessionId) => {
            const extracted = readSession(db, sessionId);
            return {
                sessionId,
                revision: extracted.sourceDigest ?? '',
                messageCount: extracted.messages.length,
            };
        });
    });
}

export function extractCopilotStoreSession(
    filePath: string,
    sessionId: string,
): ExtractedSession {
    if (!sessionId.trim()) {
        throw new Error('Copilot session-store.db extraction requires a session ID');
    }
    return withReadOnlyDatabase(filePath, (db) => readSession(db, sessionId));
}
