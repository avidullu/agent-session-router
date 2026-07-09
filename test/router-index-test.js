// Unit tests for the .router-index.jsonl writer: schema, seconds mtime,
// session-id dedup (later wins), distinct sessions, malformed tolerance.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { writeRouterIndex } = require('../out/router-index');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (err) {
        console.log(`  FAIL: ${name} - ${err.message}`);
        failed++;
    }
}

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'router-index-'));
}

function rec(over) {
    return Object.assign(
        {
            sourceName: 'copilot-vscode',
            sourceKind: 'copilot_chat',
            filePath: '/x/main.jsonl',
            sessionId: 's1',
            digest: 'abc',
            sizeBytes: 10,
            mtimeMs: 2000,
            markdownPath: '/a/archive/copilot-vscode/s1.md',
            markdownRel: 'archive/copilot-vscode/s1.md',
            messages: 3,
            metadata: { session_id: 's1' },
            exportedAt: 'x',
        },
        over,
    );
}

function readRecords(dir) {
    return fs
        .readFileSync(path.join(dir, '.router-index.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
}

console.log('Router index writer:\n');

test('writes one contract-schema record per session', () => {
    const dir = tmpDir();
    writeRouterIndex(dir, [rec()]);
    const records = readRecords(dir);
    assert.strictEqual(records.length, 1);
    assert.deepStrictEqual(records[0], {
        source: 'copilot-vscode',
        kind: 'copilot_chat',
        source_file: '/x/main.jsonl',
        sha256: 'abc',
        size: 10,
        mtime: 2,
        messages: 3,
        markdown: 'archive/copilot-vscode/s1.md',
        metadata: { session_id: 's1' },
    });
});

test('mtime is epoch seconds (ms / 1000)', () => {
    const dir = tmpDir();
    writeRouterIndex(dir, [rec({ mtimeMs: 1751436692000 })]);
    assert.strictEqual(readRecords(dir)[0].mtime, 1751436692);
});

test('dedupes by session_id across runs; later record wins', () => {
    const dir = tmpDir();
    writeRouterIndex(dir, [rec({ digest: 'old' })]);
    writeRouterIndex(dir, [rec({ digest: 'new' })]);
    const records = readRecords(dir);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].sha256, 'new');
});

test('keeps distinct sessions', () => {
    const dir = tmpDir();
    writeRouterIndex(dir, [rec({ sessionId: 's1', metadata: { session_id: 's1' } })]);
    writeRouterIndex(dir, [rec({ filePath: '/x/b.jsonl', metadata: { session_id: 's2' } })]);
    assert.strictEqual(readRecords(dir).length, 2);
});

test('tolerates malformed existing lines', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, '.router-index.jsonl'), 'not json\n{bad\n', 'utf-8');
    writeRouterIndex(dir, [rec()]);
    const records = readRecords(dir);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].source, 'copilot-vscode');
});

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
