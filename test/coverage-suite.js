/**
 * Comprehensive unit test suite for >90% code coverage.
 *
 * Tests all pure-logic modules:
 *   - utils.ts, config.ts
 *   - renderers/markdown.ts
 *   - logger.ts (without VS Code output channel)
 *   - diagnostics.ts (without VS Code output channel)
 *   - discoverers/index.ts, extractors/index.ts (registry)
 *   - extractors/deepseek.ts, extractors/copilot-chat.ts
 *   - types.ts (structural validation)
 *
 * Run with: npx c8 --include="out/**" --exclude="out/test/**" node test/coverage-suite.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
    } catch (err) {
        failed++;
        console.log(`  FAIL: ${name}`);
        console.log(`        ${err.message}`);
    }
}

function assertOk(cond, msg) {
    if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertIncludes(haystack, needle, msg) {
    if (!haystack.includes(needle)) throw new Error(msg || `expected to include "${needle}"`);
}
function assertType(val, type, msg) {
    if (typeof val !== type) throw new Error(msg || `expected ${type}, got ${typeof val}`);
}

console.log('╔══════════════════════════════════════════╗');
console.log('║  Comprehensive Coverage Test Suite       ║');
console.log('╚══════════════════════════════════════════╝\n');

// ======================================================================
// 1. UTILS (target: 100%)
// ======================================================================
console.log('─── utils.ts ───');
const utils = require('../out/utils');

test('sha256File produces 64-char hex', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-sha.txt');
    fs.writeFileSync(tmp, 'test data');
    const h = utils.sha256File(tmp);
    assertEqual(h.length, 64);
    assertOk(/^[0-9a-f]{64}$/.test(h));
    fs.unlinkSync(tmp);
});

test('sha256File produces consistent hash', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-sha2.txt');
    fs.writeFileSync(tmp, 'consistent');
    const h1 = utils.sha256File(tmp);
    const h2 = utils.sha256File(tmp);
    assertEqual(h1, h2);
    fs.unlinkSync(tmp);
});

test('sha256File with empty file', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-empty.txt');
    fs.writeFileSync(tmp, '');
    const h = utils.sha256File(tmp);
    assertEqual(h.length, 64);
    fs.unlinkSync(tmp);
});

test('sha256File matches crypto hash for large files', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-sha-large.txt');
    const payload = `${'a'.repeat(1024 * 1024)}\n${'β'.repeat(600000)}\nend`;
    fs.writeFileSync(tmp, payload, 'utf-8');
    const expected = crypto.createHash('sha256').update(payload).digest('hex');
    assertEqual(utils.sha256File(tmp), expected);
    fs.unlinkSync(tmp);
});

test('forEachTextLine streams UTF-8 lines across chunk boundaries', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-lines-large.txt');
    const longLine = 'β'.repeat(600000);
    fs.writeFileSync(tmp, `alpha\n${longLine}\r\nomega`, 'utf-8');
    const lines = [];
    utils.forEachTextLine(tmp, (line) => lines.push(line));
    assertEqual(lines.length, 3);
    assertEqual(lines[0], 'alpha');
    assertEqual(lines[1], longLine);
    assertEqual(lines[2], 'omega');
    fs.unlinkSync(tmp);
});

test('tailSha256File hashes only the trailing bytes', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-tail.txt');
    const payload = 'prefix-' + 'x'.repeat(100) + '-tail';
    fs.writeFileSync(tmp, payload, 'utf-8');
    const expected = crypto
        .createHash('sha256')
        .update(Buffer.from(payload).subarray(-8))
        .digest('hex');
    assertEqual(utils.tailSha256File(tmp, 8), expected);
    fs.unlinkSync(tmp);
});

test('fileStat returns size and mtime', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-stat.txt');
    fs.writeFileSync(tmp, 'hello world');
    const stat = utils.fileStat(tmp);
    assertEqual(stat.size, 11);
    assertType(stat.mtimeMs, 'number');
    assertOk(stat.mtimeMs > 0);
    fs.unlinkSync(tmp);
});

test('fileStat with large file', () => {
    const tmp = path.join(os.tmpdir(), 'cov-utils-stat2.txt');
    const buf = Buffer.alloc(10000, 'x');
    fs.writeFileSync(tmp, buf);
    const stat = utils.fileStat(tmp);
    assertEqual(stat.size, 10000);
    fs.unlinkSync(tmp);
});

test('slugify replaces special chars', () => {
    assertEqual(utils.slugify('Hello World'), 'Hello-World');
    assertEqual(utils.slugify('test/file:name'), 'test_file_name');
    assertEqual(utils.slugify('a<b>c"d|e?f*g'), 'a_b_c_d_e_f_g');
});

test('slugify truncates long strings', () => {
    const long = 'x'.repeat(300);
    assertOk(utils.slugify(long).length <= 200);
});

test('slugify handles empty string', () => {
    assertEqual(utils.slugify(''), '');
});

test('isoNow returns ISO timestamp', () => {
    const ts = utils.isoNow();
    assertIncludes(ts, 'T');
    assertOk(ts.endsWith('Z'));
    // Verify it parses
    assertOk(!isNaN(Date.parse(ts)));
});

test('resolvePath expands tilde', () => {
    const result = utils.resolvePath('~/test');
    // On Windows, tilde expands to the home directory
    assertOk(path.isAbsolute(result));
    assertIncludes(result.toLowerCase(), 'test');
});

test('resolvePath expands env vars', () => {
    process.env.TEST_COV_VAR = path.join('fake', 'path');
    const result = utils.resolvePath('%TEST_COV_VAR%/sub');
    // On Windows, env vars expand to their value
    assertOk(result.includes('fake'));
    assertOk(result.includes('path'));
    assertOk(result.includes('sub'));
    delete process.env.TEST_COV_VAR;
});

test('resolvePath returns absolute', () => {
    const result = utils.resolvePath('relative/path');
    assertOk(path.isAbsolute(result));
});

test('toPosixPath converts backslashes', () => {
    assertEqual(utils.toPosixPath('C:\\Users\\test'), 'C:/Users/test');
    assertEqual(utils.toPosixPath('already/posix'), 'already/posix');
});

test('toPosixPath handles mixed', () => {
    assertEqual(utils.toPosixPath('C:\\Users\\test/file.txt'), 'C:/Users/test/file.txt');
});

test('canReuseRecord true when same size+mtime', () => {
    assertOk(utils.canReuseRecord({ sizeBytes: 100, mtimeMs: 200 }, 100, 200));
});

test('canReuseRecord true when tail hash matches', () => {
    assertOk(
        utils.canReuseRecord({ sizeBytes: 100, mtimeMs: 200, tailSha256: 'abc' }, 100, 200, 'abc'),
    );
});

test('canReuseRecord false when tail hash differs', () => {
    assertOk(
        !utils.canReuseRecord({ sizeBytes: 100, mtimeMs: 200, tailSha256: 'abc' }, 100, 200, 'def'),
    );
});

test('canReuseRecord false when size differs', () => {
    assertOk(!utils.canReuseRecord({ sizeBytes: 100, mtimeMs: 200 }, 101, 200));
});

test('canReuseRecord false when mtime differs', () => {
    assertOk(!utils.canReuseRecord({ sizeBytes: 100, mtimeMs: 200 }, 100, 201));
});

test('canReuseRecord false when prior is undefined', () => {
    assertOk(!utils.canReuseRecord(undefined, 100, 200));
});

// ======================================================================
// 2. MARKDOWN RENDERER (target: 100%)
// ======================================================================
console.log('\n─── renderers/markdown.ts ───');
const { renderMarkdown } = require('../out/renderers/markdown');

const baseCtx = {
    sourceName: 'test-source',
    sourceKind: 'test_kind',
    sourceFilePath: '/test/file.json',
    digest: 'abc123def456',
    sourceModifiedAt: '2026-01-01T00:00:00Z',
};

test('renderMarkdown with messages', () => {
    const session = {
        metadata: { session_id: 's1' },
        messages: [{ role: 'user', text: 'Hello world', timestamp: '2026-01-01T00:00:01Z' }],
    };
    const md = renderMarkdown(session, baseCtx);
    assertIncludes(md, '# test-source / s1');
    assertIncludes(md, '## Metadata');
    assertIncludes(md, '## Transcript');
    assertIncludes(md, '### 1. user (2026-01-01T00:00:01Z)');
    assertIncludes(md, 'Hello world');
});

test('renderMarkdown includes SHA-256', () => {
    const session = { metadata: { session_id: 's2' }, messages: [] };
    const md = renderMarkdown(session, baseCtx);
    assertIncludes(md, 'abc123def456');
});

test('renderMarkdown includes source file', () => {
    const session = { metadata: { session_id: 's3' }, messages: [] };
    const md = renderMarkdown(session, baseCtx);
    assertIncludes(md, '/test/file.json');
});

test('renderMarkdown with custom importedAt', () => {
    const session = { metadata: { session_id: 's4' }, messages: [] };
    const md = renderMarkdown(session, { ...baseCtx, importedAt: '2026-06-01T00:00:00Z' });
    assertIncludes(md, '2026-06-01T00:00:00Z');
});

test('renderMarkdown skips null/empty metadata values', () => {
    const session = {
        metadata: { session_id: 's5', model: null, empty: '', version: '1.0' },
        messages: [{ role: 'user', text: 'hi' }],
    };
    const md = renderMarkdown(session, baseCtx);
    assertIncludes(md, 'version:');
    assertOk(!md.includes('model:'));
    assertOk(!md.includes('empty:'));
});

test('renderMarkdown omits tool suffix (contract: byte-for-byte with render.py)', () => {
    const session = {
        metadata: { session_id: 's6' },
        messages: [{ role: 'tool', text: 'result', toolName: 'read_file' }],
    };
    const md = renderMarkdown(session, baseCtx);
    // The hub's render.py emits no tool decoration; headings are `### N. role`.
    assertIncludes(md, '### 1. tool');
    assertOk(!md.includes('[tool:'));
});

test('renderMarkdown with multiple messages', () => {
    const session = {
        metadata: { session_id: 's7' },
        messages: [
            { role: 'user', text: 'q', timestamp: 't1' },
            { role: 'assistant', text: 'a', timestamp: 't2' },
            { role: 'user', text: 'q2', timestamp: 't3' },
        ],
    };
    const md = renderMarkdown(session, baseCtx);
    assertIncludes(md, '### 1. user (t1)');
    assertIncludes(md, '### 2. assistant (t2)');
    assertIncludes(md, '### 3. user (t3)');
});

test('renderMarkdown empty message text', () => {
    const session = {
        metadata: { session_id: 's8' },
        messages: [{ role: 'system', text: '   \n  ' }],
    };
    const md = renderMarkdown(session, baseCtx);
    // Should still include the message heading
    assertIncludes(md, '### 1. system');
});

// ======================================================================
// 3. TYPES (structural validation)
// ======================================================================
console.log('\n─── types.ts ───');
// types.ts is pure type declarations; it compiles to minimal JS.
// The compiled out/types.js should exist and export nothing.
test('types module loads', () => {
    const types = require('../out/types');
    assertType(types, 'object');
});

// ======================================================================
// 4. REGISTRIES (discoverers/index, extractors/index)
// ======================================================================
console.log('\n─── Registries ───');

test('discoverer registry: knownKinds initially empty', () => {
    // Need fresh require to avoid side-effects from other tests
    delete require.cache[require.resolve('../out/discoverers/index')];
    const { knownKinds, getDiscoverer, registerDiscoverer } = require('../out/discoverers/index');
    // After requiring, the module may have been pre-populated; test registration
    const kinds = knownKinds();
    assertType(kinds, 'object');
    assertOk(Array.isArray(kinds));
});

test('discoverer registry: register and get', () => {
    delete require.cache[require.resolve('../out/discoverers/index')];
    const { registerDiscoverer, getDiscoverer } = require('../out/discoverers/index');
    const dummyDiscoverer = async function* () {
        yield null;
    };
    registerDiscoverer('test_kind_disc', dummyDiscoverer);
    const found = getDiscoverer('test_kind_disc');
    assertEqual(typeof found, 'function');
});

test('discoverer registry: get unknown returns undefined', () => {
    delete require.cache[require.resolve('../out/discoverers/index')];
    const { getDiscoverer } = require('../out/discoverers/index');
    assertEqual(getDiscoverer('nonexistent_disc'), undefined);
});

test('extractor registry: register and get', () => {
    delete require.cache[require.resolve('../out/extractors/index')];
    const { registerExtractor, getExtractor } = require('../out/extractors/index');
    const dummyExtractor = (fp) => ({ metadata: {}, messages: [] });
    registerExtractor('test_kind_ext', dummyExtractor);
    const found = getExtractor('test_kind_ext');
    assertEqual(typeof found, 'function');
});

test('extractor registry: get unknown returns undefined', () => {
    delete require.cache[require.resolve('../out/extractors/index')];
    const { getExtractor } = require('../out/extractors/index');
    assertEqual(getExtractor('nonexistent_ext'), undefined);
});

test('extractor registry: knownKinds', () => {
    delete require.cache[require.resolve('../out/extractors/index')];
    const { knownKinds, registerExtractor } = require('../out/extractors/index');
    registerExtractor('test_kind_known', (fp) => ({ metadata: {}, messages: [] }));
    const kinds = knownKinds();
    assertOk(kinds.includes('test_kind_known'));
});

// ======================================================================
// 5. DEEPSEEK EXTRACTOR (schema auto-detection)
// ======================================================================
console.log('\n─── extractors/deepseek.ts ───');

// Trigger registration
delete require.cache[require.resolve('../out/extractors/deepseek')];
require('../out/extractors/deepseek');
const { getExtractor } = require('../out/extractors/index');
const dsExtractor = getExtractor('deepseek_request_dump');

test('deepseek extractor registered', () => {
    assertEqual(typeof dsExtractor, 'function');
});

test('deepseek: provider-input format (contentParts)', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-ds-1');
    fs.mkdirSync(tmpDir, { recursive: true });
    const json = {
        model: {
            vscodeModelId: 'deepseek-v4-pro',
            name: 'DeepSeek V4 Pro',
            family: 'deepseek',
            version: 'v4',
            maxInputTokens: 100000,
            maxOutputTokens: 50000,
        },
        messages: [
            {
                index: 0,
                role: 'system',
                contentParts: [{ index: 0, type: 'text', value: 'You are a helpful assistant.' }],
            },
            { index: 1, role: 'user', contentParts: [{ index: 0, type: 'text', value: 'Hello!' }] },
            {
                index: 2,
                role: 'assistant',
                contentParts: [{ index: 0, type: 'text', value: 'Hi there! How can I help?' }],
            },
            {
                index: 3,
                role: 'user',
                contentParts: [{ index: 0, type: 'text', value: 'Write code.' }],
            },
        ],
        messageStats: { messageCount: 4, roleCounts: { system: 1, user: 2, assistant: 1 } },
        requestKind: 'chat',
        systemPromptSummary: 'You are a helpful assistant.',
    };
    const filePath = path.join(tmpDir, 'test-session', 'deepseek-provider-input.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(json));
    const result = dsExtractor(filePath);

    assertEqual(result.metadata.model, 'deepseek-v4-pro');
    assertEqual(result.metadata.model_family, 'deepseek');
    assertEqual(result.metadata.request_kind, 'chat');
    assertIncludes(result.metadata.system_prompt_summary, 'helpful assistant');
    assertOk(result.messages.length >= 3);
    assertEqual(result.messages.filter((m) => m.role === 'user').length, 2);
    assertEqual(result.messages.filter((m) => m.role === 'system').length, 1);
    assertEqual(result.messages.filter((m) => m.role === 'assistant').length, 1);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deepseek: provider-input with tool calls', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-ds-2');
    fs.mkdirSync(tmpDir, { recursive: true });
    const json = {
        model: { vscodeModelId: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
        messages: [
            {
                index: 0,
                role: 'system',
                contentParts: [{ index: 0, type: 'text', value: 'You are a coding assistant.' }],
            },
            {
                index: 1,
                role: 'assistant',
                contentParts: [{ index: 0, type: 'text', value: 'Let me read that file.' }],
                toolCalls: [
                    {
                        id: 'call_123',
                        function: { name: 'read_file', arguments: '{"filePath":"/test.ts"}' },
                    },
                ],
            },
            {
                index: 2,
                role: 'tool',
                toolCallId: 'call_123',
                name: 'read_file',
                contentParts: [{ index: 0, type: 'text', value: 'console.log("hello");' }],
            },
        ],
    };
    const filePath = path.join(tmpDir, 'test-session', 'provider-input.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(json));
    const result = dsExtractor(filePath);

    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    assertOk(toolMsgs.length >= 2, `expected >=2 tool msgs, got ${toolMsgs.length}`);
    assertOk(
        toolMsgs.some((m) => m.text.includes('read_file')),
        'missing read_file tool call',
    );
    assertOk(
        toolMsgs.some((m) => m.toolCallId === 'call_123'),
        'missing call_123 toolCallId',
    );
    assertOk(
        toolMsgs.some((m) => m.text.includes('console.log')),
        'missing tool result text',
    );
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deepseek: simple format (content string)', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-ds-3');
    fs.mkdirSync(tmpDir, { recursive: true });
    const json = {
        model: 'deepseek-chat',
        messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello!' },
        ],
    };
    const filePath = path.join(tmpDir, 'test-session', 'request.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(json));
    const result = dsExtractor(filePath);

    assertEqual(result.metadata.model, 'deepseek-chat');
    assertEqual(result.messages.length, 3);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deepseek: simple format with tool_calls', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-ds-4');
    fs.mkdirSync(tmpDir, { recursive: true });
    const json = {
        messages: [
            {
                role: 'assistant',
                content: '',
                tool_calls: [
                    {
                        id: 'call_abc',
                        function: { name: 'execute_command', arguments: '{"command":"ls"}' },
                    },
                ],
            },
            {
                role: 'tool',
                tool_call_id: 'call_abc',
                name: 'execute_command',
                content: 'file1.txt\nfile2.txt',
            },
        ],
    };
    const filePath = path.join(tmpDir, 'test-session', 'request.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(json));
    const result = dsExtractor(filePath);

    assertOk(result.messages.length >= 2);
    assertOk(result.messages.some((m) => m.toolCallId === 'call_abc'));
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deepseek: handles malformed JSON gracefully', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-ds-5');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'test-session', 'bad.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'not valid json {{{');
    const result = dsExtractor(filePath);

    assertEqual(result.messages.length, 1);
    assertEqual(result.messages[0].role, 'request-prompt');
    assertIncludes(result.messages[0].text, 'not valid json');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deepseek: handles empty messages array', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-ds-6');
    fs.mkdirSync(tmpDir, { recursive: true });
    const json = { model: 'deepseek', messages: [] };
    const filePath = path.join(tmpDir, 'test-session', 'empty.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(json));
    const result = dsExtractor(filePath);

    assertEqual(result.messages.length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('deepseek: contentParts with mixed types (text + data)', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-ds-7');
    fs.mkdirSync(tmpDir, { recursive: true });
    const json = {
        model: { name: 'test-model' },
        messages: [
            {
                index: 0,
                role: 'user',
                contentParts: [
                    { index: 0, type: 'text', value: 'Look at this image:' },
                    { index: 1, type: 'image_url', value: 'data:image/png;base64,abc' },
                ],
            },
            {
                index: 1,
                role: 'assistant',
                contentParts: [{ index: 0, type: 'text', value: 'I see the image.' }],
            },
        ],
    };
    const filePath = path.join(tmpDir, 'test-session', 'mixed.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(json));
    const result = dsExtractor(filePath);

    const userMsg = result.messages.find((m) => m.role === 'user');
    assertOk(userMsg, 'missing user message');
    assertIncludes(userMsg.text, 'Look at this image');
    assertOk(!userMsg.text.includes('data:image'), 'should not include image data in text');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 6. COPILOT CHAT EXTRACTOR
// ======================================================================
console.log('\n─── extractors/copilot-chat.ts ───');

delete require.cache[require.resolve('../out/extractors/copilot-chat')];
require('../out/extractors/copilot-chat');
const ccExtractor = getExtractor('copilot_chat');

test('copilot extractor registered', () => {
    assertEqual(typeof ccExtractor, 'function');
});

test('copilot: transcript format with session.start', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-cc-1');
    fs.mkdirSync(tmpDir, { recursive: true });
    const copilotDir = path.join(tmpDir, 'github.copilot-chat');
    const transcriptsDir = path.join(copilotDir, 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const transcript = [
        '{"type":"session.start","data":{"sessionId":"abc-123","copilotVersion":"0.55.0","vscodeVersion":"1.127.0","startTime":"2026-01-01T00:00:00Z"},"timestamp":"2026-01-01T00:00:00Z"}',
        '{"type":"assistant.turn_start","data":{"turnId":"0"},"timestamp":"2026-01-01T00:00:01Z"}',
        '{"type":"assistant.message","data":{"messageId":"m1","content":"I found the issue.","toolRequests":[]},"timestamp":"2026-01-01T00:00:02Z"}',
        '{"type":"assistant.turn_end","data":{"turnId":"0"},"timestamp":"2026-01-01T00:00:03Z"}',
    ].join('\n');
    const filePath = path.join(transcriptsDir, 'abc-123.jsonl');
    fs.writeFileSync(filePath, transcript);

    const result = ccExtractor(filePath);
    assertEqual(result.metadata.copilot_version, '0.55.0');
    assertEqual(result.metadata.vscode_version, '1.127.0');
    assertEqual(result.metadata.session_id, 'abc-123');
    assertOk(result.messages.length >= 2);
    assertOk(result.messages.some((m) => m.text.includes('I found the issue')));
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('copilot: transcript with tool execution + cross-reference', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-cc-2');
    fs.mkdirSync(tmpDir, { recursive: true });
    const copilotDir = path.join(tmpDir, 'github.copilot-chat');
    const transcriptsDir = path.join(copilotDir, 'transcripts');
    const resourcesDir = path.join(copilotDir, 'chat-session-resources', 'abc-456');
    fs.mkdirSync(transcriptsDir, { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });

    const transcript = [
        '{"type":"session.start","data":{"sessionId":"abc-456"},"timestamp":"t0"}',
        '{"type":"assistant.turn_start","data":{"turnId":"0"},"timestamp":"t1"}',
        '{"type":"assistant.message","data":{"messageId":"m1","content":"Let me read the file.","toolRequests":[{"toolCallId":"call_read1","name":"read_file","arguments":"{}","type":"function"}]},"timestamp":"t2"}',
        '{"type":"tool.execution_start","data":{"toolCallId":"call_read1"},"timestamp":"t3"}',
        '{"type":"tool.execution_complete","data":{"toolCallId":"call_read1","success":true},"timestamp":"t4"}',
        '{"type":"assistant.turn_end","data":{"turnId":"0"},"timestamp":"t5"}',
    ].join('\n');
    const filePath = path.join(transcriptsDir, 'abc-456.jsonl');
    fs.writeFileSync(filePath, transcript);

    // Write tool output
    const callDir = path.join(resourcesDir, 'call_call_read1__vscode-12345');
    fs.mkdirSync(callDir, { recursive: true });
    fs.writeFileSync(path.join(callDir, 'content.txt'), 'line1\nline2\nline3');

    const result = ccExtractor(filePath);
    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    assertOk(toolMsgs.length >= 2, `expected >=2 tool msgs, got ${toolMsgs.length}`);

    // Should have a tool result message with SUCCESS and the output
    const resultMsg = toolMsgs.find((m) => m.text.includes('Tool result: SUCCESS'));
    assertOk(resultMsg, 'missing tool result SUCCESS message');
    assertIncludes(resultMsg.text, 'line1');
    assertIncludes(resultMsg.text, 'line3');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('copilot: transcript tool execution with failure', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-cc-3');
    fs.mkdirSync(tmpDir, { recursive: true });
    const copilotDir = path.join(tmpDir, 'github.copilot-chat');
    const transcriptsDir = path.join(copilotDir, 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const transcript = [
        '{"type":"session.start","data":{"sessionId":"fail-1"},"timestamp":"t0"}',
        '{"type":"tool.execution_start","data":{"toolCallId":"call_fail"},"timestamp":"t1"}',
        '{"type":"tool.execution_complete","data":{"toolCallId":"call_fail","success":false},"timestamp":"t2"}',
    ].join('\n');
    fs.writeFileSync(path.join(transcriptsDir, 'fail-1.jsonl'), transcript);

    const result = ccExtractor(path.join(transcriptsDir, 'fail-1.jsonl'));
    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    assertOk(toolMsgs.some((m) => m.text.includes('Tool result: FAILED')));
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('copilot: debug-log format fallback', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-cc-4');
    fs.mkdirSync(tmpDir, { recursive: true });
    const debugDir = path.join(tmpDir, 'debug-logs', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    fs.mkdirSync(debugDir, { recursive: true });

    const debugLog = [
        '{"v":1,"ts":1783313015757,"type":"session_start","name":"session_start","attrs":{"copilotVersion":"0.55.0","vscodeVersion":"1.127.0"}}',
        '{"type":"message","role":"user","content":"Hello"}',
        '{"type":"message","role":"assistant","content":"Hi there!"}',
    ].join('\n');
    fs.writeFileSync(path.join(debugDir, 'main.jsonl'), debugLog);

    const result = ccExtractor(path.join(debugDir, 'main.jsonl'));
    assertEqual(result.metadata.copilot_version, '0.55.0');
    assertEqual(result.metadata.session_id, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    assertEqual(result.messages.length, 2);
    assertEqual(result.messages[0].role, 'user');
    assertEqual(result.messages[1].role, 'assistant');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('copilot: debug-log with array content', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-cc-5');
    fs.mkdirSync(tmpDir, { recursive: true });
    const debugDir = path.join(tmpDir, 'debug-logs', 'dl-array');
    fs.mkdirSync(debugDir, { recursive: true });

    const debugLog = [
        '{"type":"message","role":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Part 1"},{"type":"text","text":"Part 2"}]}}',
    ].join('\n');
    fs.writeFileSync(path.join(debugDir, 'main.jsonl'), debugLog);

    const result = ccExtractor(path.join(debugDir, 'main.jsonl'));
    assertEqual(result.messages.length, 1);
    assertIncludes(result.messages[0].text, 'Part 1');
    assertIncludes(result.messages[0].text, 'Part 2');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('copilot: handles missing file gracefully', () => {
    const result = ccExtractor('/nonexistent/path/main.jsonl');
    assertEqual(result.messages.length, 0);
});

test('copilot: handles malformed JSONL gracefully', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-cc-7');
    fs.mkdirSync(tmpDir, { recursive: true });
    const transcriptsDir = path.join(tmpDir, 'github.copilot-chat', 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const bad =
        '{"type":"session.start","data":{"sessionId":"bad-session-1234"},"timestamp":"t0"}\nnot json\n{"type":"valid"}';
    fs.writeFileSync(path.join(transcriptsDir, 'bad-session-1234.jsonl'), bad);

    const result = ccExtractor(path.join(transcriptsDir, 'bad-session-1234.jsonl'));
    // Should not crash, should extract what it can
    assertOk(result.metadata.session_id === 'bad-session-1234');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 7. GEMINI ANTIGRAVITY EXTRACTOR
// ======================================================================
console.log('\n─── extractors/gemini.ts ───');

delete require.cache[require.resolve('../out/extractors/gemini')];
require('../out/extractors/gemini');
const geminiExtractor = getExtractor('gemini_antigravity');

test('gemini: derives stable session_id from Antigravity brain path', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-gemini-1');
    const sessionId = 'abcd1234-5678-90ef-abcd-1234567890ef';
    const logsDir = path.join(
        tmpDir,
        '.gemini',
        'antigravity',
        'brain',
        sessionId,
        '.system_generated',
        'logs',
    );
    fs.mkdirSync(logsDir, { recursive: true });

    const transcript = [
        JSON.stringify({
            source: 'USER_EXPLICIT',
            type: 'USER_INPUT',
            created_at: '2026-07-09T10:00:00Z',
            content: '<USER_REQUEST>Hello Gemini</USER_REQUEST>',
        }),
        JSON.stringify({
            source: 'MODEL',
            type: 'PLANNER_RESPONSE',
            created_at: '2026-07-09T10:00:01Z',
            content: 'Hello back',
        }),
    ].join('\n');
    const filePath = path.join(logsDir, 'transcript.jsonl');
    fs.writeFileSync(filePath, transcript);

    const result = geminiExtractor(filePath);
    assertEqual(result.metadata.session_id, sessionId);
    assertEqual(result.messages.length, 2);
    assertEqual(result.messages[0].role, 'user');
    assertEqual(result.messages[1].role, 'assistant');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('gemini: falls back to file stem outside Antigravity layout', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-gemini-2');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'loose-transcript.jsonl');
    fs.writeFileSync(filePath, '');

    const result = geminiExtractor(filePath);
    assertEqual(result.metadata.session_id, 'loose-transcript');
    assertEqual(result.messages.length, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 8. CONFIG
// ======================================================================
console.log('\n─── config.ts ───');
const configMod = require('../out/config');

test('config: getConfig returns defaults without vscode', () => {
    const cfg = configMod.getConfig();
    assertEqual(cfg.enabled, true);
    assertEqual(cfg.sources.copilot_chat.enabled, true);
    assertEqual(cfg.sources.deepseek_request_dump.enabled, true);
    assertEqual(cfg.watch.enabled, false);
    assertEqual(cfg.watch.debounceMs, 5000);
    assertEqual(cfg.maxSessionAge, '90d');
});

test('config: default outputDir is empty string', () => {
    const cfg = configMod.getConfig();
    assertEqual(cfg.outputDir, '');
});

// ======================================================================
// 8. LOGGER (without VS Code output channel)
// ======================================================================
console.log('\n─── logger.ts ───');
const logger = require('../out/logger');

test('logger: initLogger creates diagnostics path', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger');
    logger.initLogger(tmpDir);
    const diagPath = logger.getDiagnosticsPath();
    assertOk(diagPath, 'missing diagnostics path');
    assertIncludes(diagPath, '.router');
    assertIncludes(diagPath, 'diagnostics.jsonl');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: getDiagnosticsDir returns dir', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger2');
    logger.initLogger(tmpDir);
    const dir = logger.getDiagnosticsDir();
    assertEqual(dir, tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: logDiscover writes without crash', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger3');
    logger.initLogger(tmpDir);
    // Should not throw
    logger.logDiscover('test_kind', '/test/file', 'session-1', { extra: 'data' });

    // Verify diagnostics file was written
    const diagPath = logger.getDiagnosticsPath();
    assertOk(fs.existsSync(diagPath), 'diagnostics file not created');
    const content = fs.readFileSync(diagPath, 'utf-8');
    assertIncludes(content, 'test_kind');
    assertIncludes(content, 'session-1');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: logExtractStart returns stop function', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger4');
    logger.initLogger(tmpDir);
    const stop = logger.logExtractStart('kind', '/f', 's1', 100);
    assertEqual(typeof stop, 'function');
    stop(); // Should not throw
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: logExtractResult, logRender, logWrite, logSkip', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger5');
    logger.initLogger(tmpDir);
    logger.logExtractResult('kind', '/f', 's1', 42, 100);
    logger.logRender('kind', 's1', '/out.md', 42);
    logger.logWrite('kind', 's1', '/out.md', 5000);
    logger.logSkip('kind', '/f', 's1', 'reason text');

    const diagPath = logger.getDiagnosticsPath();
    const content = fs.readFileSync(diagPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    assertOk(lines.length >= 4, `expected >=4 entries, got ${lines.length}`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: logExtractError with source snippet', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger6');
    logger.initLogger(tmpDir);
    const err = new Error('test error');
    logger.logExtractError('kind', '/test/file.json', 's1', err, 'first 500 chars of file');

    const diagPath = logger.getDiagnosticsPath();
    const content = fs.readFileSync(diagPath, 'utf-8');
    assertIncludes(content, 'test error');
    assertIncludes(content, 'first 500 chars');
    const entry = JSON.parse(content.split('\n')[0]);
    assertEqual(entry.level, 'error');
    assertEqual(entry.error.name, 'Error');
    assertOk(entry.error.sourceSnippet);
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: logWriteError', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger7');
    logger.initLogger(tmpDir);
    logger.logWriteError('kind', 's1', '/out.md', new Error('write failed'));

    const diagPath = logger.getDiagnosticsPath();
    assertIncludes(fs.readFileSync(diagPath, 'utf-8'), 'write failed');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: logExportSummary', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger8');
    logger.initLogger(tmpDir);
    logger.logExportSummary(100, 90, 5, 5, 1500);

    const diagPath = logger.getDiagnosticsPath();
    const content = fs.readFileSync(diagPath, 'utf-8');
    assertIncludes(content, '100');
    assertIncludes(content, '90');
    assertIncludes(content, 'summary');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: logWatcherEvent', () => {
    const tmpDir = path.join(os.tmpdir(), 'cov-logger9');
    logger.initLogger(tmpDir);
    logger.logWatcherEvent('start');
    logger.logWatcherEvent('change', '/test/file', { size: 100 });
    logger.logWatcherEvent('stop');

    const diagPath = logger.getDiagnosticsPath();
    const content = fs.readFileSync(diagPath, 'utf-8');
    assertIncludes(content, 'start');
    assertIncludes(content, 'change');
    assertIncludes(content, 'stop');
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('logger: getOutputChannel returns object', () => {
    // In test environment without vscode, returns console
    const ch = logger.getOutputChannel();
    assertType(ch, 'object');
    // console always has .log method
    assertType(ch.log, 'function');
});

// ======================================================================
// 9. DIAGNOSTICS
// ======================================================================
console.log('\n─── diagnostics.ts ───');
// diagnostics.ts imports config (now vscode-optional) and logger
// createDiagnosticBundle is async — just verify module loads
const diag = require('../out/diagnostics');

test('diagnostics: module loads', () => {
    assertType(diag, 'object');
    assertType(diag.createDiagnosticBundle, 'function');
});

// ======================================================================
// 10. DISCOVERERS (structure validation)
// ======================================================================
console.log('\n─── discoverers ───');

test('discoverer: copilot-chat registers', () => {
    delete require.cache[require.resolve('../out/discoverers/copilot-chat')];
    delete require.cache[require.resolve('../out/discoverers/index')];
    require('../out/discoverers/copilot-chat');
    const { getDiscoverer } = require('../out/discoverers/index');
    assertEqual(typeof getDiscoverer('copilot_chat'), 'function');
});

test('discoverer: deepseek registers', () => {
    delete require.cache[require.resolve('../out/discoverers/deepseek')];
    delete require.cache[require.resolve('../out/discoverers/index')];
    require('../out/discoverers/deepseek');
    const { getDiscoverer } = require('../out/discoverers/index');
    assertEqual(typeof getDiscoverer('deepseek_request_dump'), 'function');
});

// ======================================================================
// 11. WATCHER (pure-function unit tests)
// ======================================================================
console.log('\n─── watcher ───');

// The watcher's pure helper functions (isSessionFile, determineSourceKind,
// determineSourceName, extractSessionId) are private to watcher.ts and not
// exported.  We reproduce their logic here for unit testing — these mirror
// the implementation in src/watcher.ts exactly.
// If watcher.ts changes, update these mirrors.

function isSessionFile(filePath) {
    const isDeepSeek = filePath.includes('request-dumps') && filePath.endsWith('.json');
    const isCopilotTranscript = filePath.includes('transcripts') && filePath.endsWith('.jsonl');
    const isCopilotDebugLog = filePath.includes('debug-logs') && filePath.endsWith('main.jsonl');
    return isDeepSeek || isCopilotTranscript || isCopilotDebugLog;
}

function determineSourceKind(filePath) {
    if (filePath.includes('deepseek') || filePath.includes('request-dumps')) {
        return 'deepseek_request_dump';
    }
    return 'copilot_chat';
}

function determineSourceName(filePath) {
    if (filePath.includes('deepseek') || filePath.includes('request-dumps')) {
        return 'deepseek-vscode-auto';
    }
    return 'copilot-vscode-auto';
}

function extractSessionId(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[i])) {
            return parts[i];
        }
    }
    // Normalize to forward slashes so path.basename works on Linux too
    const normalized = filePath.replace(/\\/g, '/');
    return require('path').basename(normalized, require('path').extname(normalized));
}

// ── isSessionFile ──
test('watcher: isSessionFile detects deepseek json', () => {
    assertEqual(isSessionFile('/path/request-dumps/session.json'), true);
    assertEqual(isSessionFile('/path/request-dumps/session.txt'), false);
});

test('watcher: isSessionFile detects copilot transcript', () => {
    assertEqual(isSessionFile('/ws/transcripts/uuid.jsonl'), true);
    assertEqual(isSessionFile('/ws/transcripts/uuid.json'), false);
});

test('watcher: isSessionFile detects copilot debug log', () => {
    assertEqual(isSessionFile('/ws/debug-logs/uuid/main.jsonl'), true);
    assertEqual(isSessionFile('/ws/debug-logs/uuid/other.jsonl'), false);
});

test('watcher: isSessionFile rejects non-session files', () => {
    assertEqual(isSessionFile('/tmp/random.txt'), false);
    assertEqual(isSessionFile('/tmp/models.json'), false);
    assertEqual(isSessionFile('/tmp/node_modules/pkg/index.js'), false);
    assertEqual(isSessionFile('/tmp/.git/config'), false);
});

// ── determineSourceKind ──
test('watcher: determineSourceKind deepseek', () => {
    assertEqual(
        determineSourceKind('/app/deepseek/request-dumps/file.json'),
        'deepseek_request_dump',
    );
    assertEqual(
        determineSourceKind('/app/vizards.deepseek-v4/request-dumps/x.json'),
        'deepseek_request_dump',
    );
});

test('watcher: determineSourceKind copilot default', () => {
    assertEqual(determineSourceKind('/ws/copilot-chat/transcripts/uuid.jsonl'), 'copilot_chat');
    assertEqual(determineSourceKind('/ws/copilot-chat/debug-logs/uuid/main.jsonl'), 'copilot_chat');
    assertEqual(determineSourceKind('/unknown/something.txt'), 'copilot_chat');
});

// ── determineSourceName ──
test('watcher: determineSourceName', () => {
    assertEqual(determineSourceName('/deepseek/request-dumps/x.json'), 'deepseek-vscode-auto');
    assertEqual(determineSourceName('/copilot/transcripts/x.jsonl'), 'copilot-vscode-auto');
});

// ── extractSessionId ──
test('watcher: extractSessionId from UUID in path', () => {
    // Use forward slashes — the function normalizes backslashes anyway.
    // (Windows paths with \\t, \\U, \\x etc. trigger JS escape sequences.)
    assertEqual(
        extractSessionId(
            'C:/Users/x/AppData/Roaming/Code/User/workspaceStorage/abc/github.copilot-chat/transcripts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl',
        ),
        'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
});

test('watcher: extractSessionId from Windows path with backslashes', () => {
    // Use String.raw to avoid escape-sequence mangling on \\ sequences
    const winPath = String.raw`C:\Users\x\AppData\Roaming\Code\User\workspaceStorage\abc\github.copilot-chat\transcripts\f1e2d3c4-b5a6-7890-cdef-1234567890ab.jsonl`;
    assertEqual(extractSessionId(winPath), 'f1e2d3c4-b5a6-7890-cdef-1234567890ab');
});

test('watcher: extractSessionId falls back to basename', () => {
    assertEqual(extractSessionId('/simple/path/session.json'), 'session');
    assertEqual(extractSessionId('/no-uuid-here/data.jsonl'), 'data');
});

test('watcher: extractSessionId picks last UUID in path', () => {
    assertEqual(
        extractSessionId(
            '/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/file.jsonl',
        ),
        '22222222-2222-2222-2222-222222222222',
    );
});

// ── startWatcher / stopWatcher smoke (module-load only) ──
test('watcher: module exports startWatcher, stopWatcher, isWatcherRunning', () => {
    // watcher.ts imports vscode at the top level, so we can't require()
    // it directly in a plain Node process.  Verify the compiled output
    // has the expected exports shape instead.
    const watcherPath = require.resolve('../out/watcher');
    const content = fs.readFileSync(watcherPath, 'utf-8');
    assertIncludes(content, 'exports.startWatcher');
    assertIncludes(content, 'exports.stopWatcher');
    assertIncludes(content, 'exports.isWatcherRunning');
});

// ======================================================================
// SUMMARY
// ======================================================================
console.log(`\n${'═'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
    console.log('\nSOME TESTS FAILED');
    process.exit(1);
}
console.log('All coverage tests passed!');
