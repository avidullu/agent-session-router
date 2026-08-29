// Integration tests for current Copilot Chat globalStorage/session-store.db.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

let DatabaseSync;
try {
    ({ DatabaseSync } = require('node:sqlite'));
} catch {
    console.log('Copilot SQLite store: SKIP (node:sqlite requires Node.js 22.5+)');
    process.exit(0);
}

const {
    extractCopilotStoreSession,
    listCopilotStoreSessions,
} = require('../out/copilot-session-store');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-session-store-'));
const dbPath = path.join(tmpDir, 'session-store.db');
const db = new DatabaseSync(dbPath);

db.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (3);
    CREATE TABLE sessions (
        id TEXT PRIMARY KEY, cwd TEXT, repository TEXT, host_type TEXT, branch TEXT,
        summary TEXT, agent_name TEXT, agent_description TEXT,
        created_at TEXT, updated_at TEXT
    );
    CREATE TABLE turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        user_message TEXT,
        assistant_response TEXT,
        timestamp TEXT
    );
`);

const insertSession = db.prepare(`
    INSERT INTO sessions (
        id, cwd, repository, host_type, branch, summary, agent_name,
        agent_description, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
insertSession.run(
    'session-a',
    '/workspace/project',
    'example/project',
    'local',
    'main',
    'Fix the export path',
    'Copilot',
    'Coding agent',
    '2026-08-29T01:00:00Z',
    '2026-08-29T01:02:00Z',
);
insertSession.run(
    'session-empty',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    '2026-08-29T02:00:00Z',
    '2026-08-29T02:00:00Z',
);

const insertTurn = db.prepare(`
    INSERT INTO turns (session_id, turn_index, user_message, assistant_response, timestamp)
    VALUES (?, ?, ?, ?, ?)
`);
insertTurn.run(
    'session-a',
    1,
    '  second request  ',
    '  second response  ',
    '2026-08-29T01:02:00Z',
);
insertTurn.run(
    'session-a',
    0,
    'first request',
    'first response',
    '2026-08-29T01:01:00Z',
);
db.close();

try {
    const summaries = listCopilotStoreSessions(dbPath);
    assert.strictEqual(summaries.length, 2);
    assert.strictEqual(summaries[0].sessionId, 'session-a');
    assert.strictEqual(summaries[0].messageCount, 4);
    assert.match(summaries[0].revision, /^[0-9a-f]{64}$/);
    assert.strictEqual(summaries[1].messageCount, 0);

    const extracted = extractCopilotStoreSession(dbPath, 'session-a');
    assert.strictEqual(extracted.metadata.session_id, 'session-a');
    assert.strictEqual(extracted.metadata.source_format, 'copilot_session_store');
    assert.strictEqual(extracted.metadata.source_schema_version, 3);
    assert.strictEqual(extracted.metadata.repository, 'example/project');
    assert.strictEqual(extracted.messages.length, 4);
    assert.deepStrictEqual(
        extracted.messages.map((message) => [message.role, message.text]),
        [
            ['user', 'first request'],
            ['assistant', 'first response'],
            ['user', 'second request'],
            ['assistant', 'second response'],
        ],
    );
    assert.strictEqual(extracted.sourceDigest, summaries[0].revision);
    assert.strictEqual(
        extracted.metadata.source_revision,
        summaries[0].revision,
        'rendered metadata should carry the logical snapshot revision',
    );

    const beforeHash = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    extractCopilotStoreSession(dbPath, 'session-a');
    const afterHash = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    assert.strictEqual(afterHash, beforeHash, 'read-only extraction must not mutate the store');

    assert.throws(
        () => extractCopilotStoreSession(dbPath, 'missing-session'),
        /session not found/,
    );
    console.log('Copilot SQLite store: PASS');
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}
