// Integration test: Copilot Chat extractor with real transcript data
const { getExtractor } = require('../out/extractors/index');

// Trigger registration
require('../out/extractors/copilot-chat');

const extractor = getExtractor('copilot_chat');
if (!extractor) {
    console.error('FAIL: copilot_chat extractor not registered');
    process.exit(1);
}

console.log('Copilot Chat Extractor — Integration Tests\n');

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

// ---- Test 1: Transcript format parsing (mock data) ----
test('parses session.start metadata', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpDir = path.join(os.tmpdir(), 'copilot-extractor-test');
    const transcriptsDir = path.join(tmpDir, 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const mockTranscript = [
        '{"type":"session.start","data":{"sessionId":"test-123","copilotVersion":"0.55.0","vscodeVersion":"1.127.0","startTime":"2026-07-08T10:00:00Z"},"timestamp":"2026-07-08T10:00:00Z"}',
        '{"type":"assistant.turn_start","data":{"turnId":"0"},"timestamp":"2026-07-08T10:00:01Z"}',
        '{"type":"assistant.message","data":{"messageId":"msg-1","content":"Hello! I can help with that.","toolRequests":[]},"timestamp":"2026-07-08T10:00:02Z"}',
        '{"type":"assistant.turn_end","data":{"turnId":"0"},"timestamp":"2026-07-08T10:00:03Z"}',
    ].join('\n');

    const filePath = path.join(transcriptsDir, 'test-123.jsonl');
    fs.writeFileSync(filePath, mockTranscript);

    const result = extractor(filePath);
    if (result.metadata.copilot_version !== '0.55.0') throw new Error('missing copilot version');
    if (result.metadata.vscode_version !== '1.127.0') throw new Error('missing vscode version');
    if (result.messages.length < 2) throw new Error(`expected >=2 messages, got ${result.messages.length}`);
    if (!result.messages.some(m => m.text.includes('Hello'))) throw new Error('missing assistant message');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- Test 2: Tool request parsing ----
test('parses tool requests in assistant messages', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpDir = path.join(os.tmpdir(), 'copilot-extractor-test-2');
    const transcriptsDir = path.join(tmpDir, 'transcripts');
    fs.mkdirSync(transcriptsDir, { recursive: true });

    const mockTranscript = [
        '{"type":"session.start","data":{"sessionId":"test-456"},"timestamp":"2026-07-08T10:00:00Z"}',
        '{"type":"assistant.turn_start","data":{"turnId":"0"},"timestamp":"2026-07-08T10:00:01Z"}',
        '{"type":"assistant.message","data":{"messageId":"msg-1","content":"","toolRequests":[{"toolCallId":"call_abc","name":"read_file","arguments":"{\\"filePath\\":\\"/test.ts\\"}","type":"function"}]},"timestamp":"2026-07-08T10:00:02Z"}',
        '{"type":"tool.execution_start","data":{"toolCallId":"call_abc"},"timestamp":"2026-07-08T10:00:03Z"}',
        '{"type":"tool.execution_complete","data":{"toolCallId":"call_abc","success":true},"timestamp":"2026-07-08T10:00:04Z"}',
        '{"type":"assistant.turn_end","data":{"turnId":"0"},"timestamp":"2026-07-08T10:00:05Z"}',
    ].join('\n');

    const filePath = path.join(transcriptsDir, 'test-456.jsonl');
    fs.writeFileSync(filePath, mockTranscript);

    const result = extractor(filePath);
    const toolCalls = result.messages.filter(m => m.role === 'tool');
    if (toolCalls.length < 3) throw new Error(`expected >=3 tool messages, got ${toolCalls.length}`);
    if (!toolCalls.some(m => m.text.includes('read_file'))) throw new Error('missing read_file tool call');
    if (!toolCalls.some(m => m.text.includes('call_abc'))) throw new Error('missing call ID');

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- Test 3: Debug-log format fallback ----
test('handles debug-log format fallback', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const tmpDir = path.join(os.tmpdir(), 'copilot-extractor-test-3');
    const debugDir = path.join(tmpDir, 'debug-logs', 'test-789');
    fs.mkdirSync(debugDir, { recursive: true });

    const mockDebugLog = [
        '{"v":1,"ts":1783313015757,"type":"session_start","name":"session_start","attrs":{"copilotVersion":"0.55.0","vscodeVersion":"1.127.0"}}',
        '{"type":"message","role":"user","content":"Hello"}',
        '{"type":"message","role":"assistant","content":"Hi there!"}',
    ].join('\n');

    const filePath = path.join(debugDir, 'main.jsonl');
    fs.writeFileSync(filePath, mockDebugLog);

    const result = extractor(filePath);
    if (result.metadata.copilot_version !== '0.55.0') throw new Error('missing copilot version from debug log');
    if (result.messages.length < 2) throw new Error(`expected >=2 messages, got ${result.messages.length}`);

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---- Summary ----
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All integration tests passed!');
