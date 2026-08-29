// Integration tests for VS Code workspaceStorage/*/chatSessions mutation logs.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    extractVSCodeChatSession,
    inspectVSCodeChatSession,
} = require('../out/vscode-chat-session');
const { manualSessionCandidates } = require('../out/manual-session');
const { collectNativeChatSessions } = require('../out/discoverers/copilot-chat');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-chat-session-'));
const chatDir = path.join(tmpDir, 'workspace-id', 'chatSessions');
const filePath = path.join(chatDir, 'zai-session.jsonl');
fs.mkdirSync(chatDir, { recursive: true });

const initial = {
    kind: 0,
    v: {
        version: 3,
        creationDate: 1787980000000,
        sessionId: 'zai-session',
        customTitle: 'Routine repair',
        requests: [],
        inputState: {
            selectedModel: {
                identifier: 'zai/Z.AI/glm-5.2',
                metadata: {
                    vendor: 'zai',
                    extension: { value: 'ltmoerdani.zai-copilot-chat' },
                },
            },
        },
    },
};
const request = {
    requestId: 'request-1',
    timestamp: 1787980001000,
    modelId: 'zai/Z.AI/glm-5.2',
    message: { text: 'Inspect the routine' },
    response: [{ value: 'It is current.' }, { kind: 'thinking', text: 'hidden' }],
};
const entries = [
    initial,
    { kind: 2, k: ['requests'], v: [request] },
    { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'No repair required.' }] },
    { kind: 1, k: ['customTitle'], v: 'Routine status' },
    { kind: 3, k: ['inputState', 'inputText'] },
];
fs.writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');

try {
    const summary = inspectVSCodeChatSession(filePath);
    assert.strictEqual(summary.sessionId, 'zai-session');
    assert.strictEqual(summary.messageCount, 2);
    assert.strictEqual(summary.modelProvider, 'zai');
    assert.match(summary.revision, /^[0-9a-f]{64}$/);
    const manualCandidates = manualSessionCandidates(filePath, fs.statSync(filePath).size, 1234);
    assert.strictEqual(manualCandidates.length, 1);
    assert.strictEqual(manualCandidates[0].session.sessionId, 'zai-session');
    assert.strictEqual(manualCandidates[0].session.sourceName, 'zai-vscode');
    assert.strictEqual(manualCandidates[0].session.sourceRevision, summary.revision);

    const copilotInitial = JSON.parse(JSON.stringify(initial));
    copilotInitial.v.sessionId = 'copilot-session';
    copilotInitial.v.inputState.selectedModel.identifier = 'copilot/gpt-5';
    copilotInitial.v.inputState.selectedModel.metadata.vendor = 'copilot';
    const copilotRequest = { ...request, requestId: 'copilot-request', modelId: 'copilot/gpt-5' };
    const copilotPath = path.join(chatDir, 'copilot-session.jsonl');
    fs.writeFileSync(
        copilotPath,
        [copilotInitial, { kind: 2, k: ['requests'], v: [copilotRequest] }]
            .map((entry) => JSON.stringify(entry))
            .join('\n') + '\n',
    );
    const deduplicated = collectNativeChatSessions(
        [tmpDir],
        new Set(['copilot-session']),
    );
    assert.deepStrictEqual(
        deduplicated.map((session) => [session.sessionId, session.sourceName]),
        [['zai-session', 'zai-vscode']],
        'native Copilot JSONL must not duplicate a session already present in SQLite',
    );

    const extracted = extractVSCodeChatSession(filePath);
    assert.strictEqual(extracted.metadata.source_format, 'vscode_chat_session_log');
    assert.strictEqual(extracted.metadata.source_schema_version, 3);
    assert.strictEqual(extracted.metadata.model_provider, 'zai');
    assert.strictEqual(extracted.metadata.model_id, 'zai/Z.AI/glm-5.2');
    assert.strictEqual(extracted.metadata.title, 'Routine status');
    assert.deepStrictEqual(
        extracted.messages.map((message) => [message.role, message.text]),
        [
            ['user', 'Inspect the routine'],
            ['assistant', 'It is current.\n\nNo repair required.'],
        ],
    );
    assert.ok(!extracted.messages.some((message) => message.text.includes('hidden')));

    fs.appendFileSync(filePath, '{"kind":1,"k":["customTitle"]');
    const partial = extractVSCodeChatSession(filePath);
    assert.strictEqual(partial.metadata.ignored_partial_tail, true);

    const unsafePath = path.join(chatDir, 'unsafe.jsonl');
    fs.writeFileSync(
        unsafePath,
        `${JSON.stringify(initial)}\n${JSON.stringify({ kind: 1, k: ['__proto__', 'polluted'], v: true })}\n`,
    );
    assert.throws(() => extractVSCodeChatSession(unsafePath), /unsafe segment/);
    assert.strictEqual({}.polluted, undefined);

    const oversizedPath = path.join(chatDir, 'oversized.jsonl');
    fs.writeFileSync(oversizedPath, '');
    fs.truncateSync(oversizedPath, 128 * 1024 * 1024 + 1);
    assert.throws(() => extractVSCodeChatSession(oversizedPath), /safety limit/);
    console.log('VS Code chat session log: PASS');
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}
