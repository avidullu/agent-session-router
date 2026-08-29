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
    iterate(...params: SqliteValue[]): IterableIterator<SqliteRow>;
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
    const hash = startSessionDigest(session);
    for (const turn of turns) updateTurnDigest(hash, turn);
    return hash.digest('hex');
}

function updateDigestValue(hash: crypto.Hash, value: unknown): void {
    const encoded = JSON.stringify(value);
    hash.update(String(Buffer.byteLength(encoded)), 'utf8');
    hash.update(':', 'utf8');
    hash.update(encoded, 'utf8');
}

function startSessionDigest(session: SessionRow): crypto.Hash {
    const hash = crypto.createHash('sha256');
    for (const value of [
        session.id,
        session.cwd,
        session.repository,
        session.host_type,
        session.branch,
        session.summary,
        session.agent_name,
        session.agent_description,
        session.created_at,
        session.updated_at,
    ]) {
        updateDigestValue(hash, value);
    }
    return hash;
}

function updateTurnDigest(hash: crypto.Hash, turn: TurnRow): void {
    for (const value of [
        turn.turn_index,
        turn.user_message,
        turn.assistant_response,
        turn.timestamp,
    ]) {
        updateDigestValue(hash, value);
    }
}

function messageCountForTurn(turn: TurnRow): number {
    return Number(Boolean(turn.user_message?.trim())) + Number(Boolean(turn.assistant_response?.trim()));
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
        const rows = db
            .prepare(
                `SELECT s.id, s.cwd, s.repository, s.host_type, s.branch, s.summary,
                        s.agent_name, s.agent_description, s.created_at, s.updated_at,
                        t.id AS turn_id, t.turn_index, t.user_message,
                        t.assistant_response, t.timestamp
                 FROM sessions AS s
                 LEFT JOIN turns AS t ON t.session_id = s.id
                 ORDER BY s.created_at ASC, s.id ASC, t.turn_index ASC, t.id ASC`,
            )
            .iterate();

        const summaries: CopilotStoreSessionSummary[] = [];
        let currentId: string | undefined;
        let currentHash: crypto.Hash | undefined;
        let currentMessageCount = 0;

        const flush = (): void => {
            if (!currentId || !currentHash) return;
            summaries.push({
                sessionId: currentId,
                revision: currentHash.digest('hex'),
                messageCount: currentMessageCount,
            });
        };

        for (const row of rows) {
            const sessionId = text(row.id);
            if (!sessionId) continue;
            if (sessionId !== currentId) {
                flush();
                currentId = sessionId;
                currentMessageCount = 0;
                currentHash = startSessionDigest({
                    id: sessionId,
                    cwd: text(row.cwd),
                    repository: text(row.repository),
                    host_type: text(row.host_type),
                    branch: text(row.branch),
                    summary: text(row.summary),
                    agent_name: text(row.agent_name),
                    agent_description: text(row.agent_description),
                    created_at: text(row.created_at),
                    updated_at: text(row.updated_at),
                });
            }
            if (row.turn_id === null || row.turn_id === undefined || !currentHash) continue;
            const turn: TurnRow = {
                turn_index: number(row.turn_index),
                user_message: text(row.user_message),
                assistant_response: text(row.assistant_response),
                timestamp: text(row.timestamp),
            };
            updateTurnDigest(currentHash, turn);
            currentMessageCount += messageCountForTurn(turn);
        }
        flush();
        return summaries;
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
