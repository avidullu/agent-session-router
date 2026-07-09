// Smoke test for agent-session-router core modules
const { sha256File, slugify, isoNow } = require('../out/utils');
const { renderMarkdown } = require('../out/renderers/markdown');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

console.log('Agent Session Router — Smoke Tests\n');

// ---- Utils ----
console.log('Utils:');
test('slugify', () => {
    const result = slugify('DeepSeek V4 / test-session');
    if (!result.includes('DeepSeek')) throw new Error(`unexpected: ${result}`);
});
test('isoNow returns ISO string', () => {
    const ts = isoNow();
    if (!ts.includes('T') || !ts.endsWith('Z')) throw new Error(`bad format: ${ts}`);
});

// ---- Markdown Renderer ----
console.log('\nMarkdown Renderer:');
test('produces correct heading', () => {
    const session = {
        metadata: { session_id: 'test-123', model: 'deepseek-v4' },
        messages: [
            { role: 'user', text: 'Hello!', timestamp: '2026-07-08T10:00:00Z' },
            { role: 'assistant', text: 'Hi there!', timestamp: '2026-07-08T10:00:05Z' },
        ]
    };
    const md = renderMarkdown(session, {
        sourceName: 'deepseek-vscode-test',
        sourceKind: 'deepseek_request_dump',
        sourceFilePath: 'C:/test/session.json',
        digest: 'abc123',
        sourceModifiedAt: '2026-07-08T10:00:00Z',
    });
    if (!md.includes('# deepseek-vscode-test / test-123')) throw new Error('missing heading');
    if (!md.includes('## Metadata')) throw new Error('missing metadata');
    if (!md.includes('## Transcript')) throw new Error('missing transcript');
    if (!md.includes('### 1. user')) throw new Error('missing first message');
    if (!md.includes('### 2. assistant')) throw new Error('missing second message');
});
test('handles empty messages', () => {
    const session = { metadata: { session_id: 'empty' }, messages: [] };
    const md = renderMarkdown(session, {
        sourceName: 'test', sourceKind: 'test', sourceFilePath: '/t.json',
        digest: 'abc', sourceModifiedAt: '2026-01-01T00:00:00Z',
    });
    if (!md.includes('No transcript messages were extracted')) throw new Error('missing empty message');
});
test('includes extra metadata', () => {
    const session = {
        metadata: { session_id: 'x', model: 'gpt-4', temperature: '0.7' },
        messages: [{ role: 'user', text: 'hi' }]
    };
    const md = renderMarkdown(session, {
        sourceName: 'test', sourceKind: 'test', sourceFilePath: '/t.json',
        digest: 'abc', sourceModifiedAt: '2026-01-01T00:00:00Z',
    });
    if (!md.includes('model:')) throw new Error('missing model metadata');
    if (!md.includes('temperature:')) throw new Error('missing temperature metadata');
});

// ---- SHA-256 ----
console.log('\nHashing:');
test('SHA-256 matches known value', () => {
    const tmpFile = path.join(os.tmpdir(), 'agent-router-smoke-test.txt');
    fs.writeFileSync(tmpFile, 'hello world');
    const digest = sha256File(tmpFile);
    fs.unlinkSync(tmpFile);
    if (digest !== 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9') {
        throw new Error(`digest mismatch: ${digest}`);
    }
});

// ---- Summary ----
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All smoke tests passed!');
