const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectionHealth, recordCollectionIssue, clearCollectionIssue } = require('../out/health');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-health-'));
const archive = path.join(root, 'archive');
const config = { enabled: true, sources: { off: { enabled: false } }, watch: { enabled: false } };
const snapshot = () => collectionHealth(archive, config, false, ['vscode_chat', 'off']);
try {
    let report = snapshot();
    assert.equal(report.collectionState, 'no_sessions');
    assert.equal(report.watcherState, 'manual_only');
    assert.equal(report.sources.off, 'disabled');
    assert.equal(report.lastSuccessfulExport, null);
    config.enabled = false;
    assert.equal(snapshot().watcherState, 'extension_disabled');
    config.enabled = true;
    config.watch.enabled = true;
    assert.equal(snapshot().watcherState, 'not_running');
    assert.equal(collectionHealth(archive, config, true, []).watcherState, 'watching');
    fs.mkdirSync(archive);
    fs.writeFileSync(path.join(archive, 'fixture.md'), '## user\nQuestion\n## assistant\nAnswer\n');
    const record = { source: 'zai-vscode', source_file: 'fixture.jsonl', metadata: { session_id: 'fixture' },
        messages: 2, markdown: 'archive/fixture.md', exported_at: '2026-09-15T12:00:00+05:30' };
    const index = path.join(archive, '.router-index.jsonl');
    fs.writeFileSync(index, JSON.stringify(record) + '\n');
    report = snapshot();
    assert.equal(report.collectionState, 'collected');
    assert.equal(report.sessions, 1);
    assert.equal(report.knownMessages, 2);
    assert.equal(report.lastSuccessfulExport, '2026-09-15T06:30:00.000Z');
    assert(report.localMarkdownBytes > 0);
    recordCollectionIssue(archive, 'fixture', 'export failed');
    assert.equal(snapshot().collectionState, 'attention_required');
    clearCollectionIssue(archive, 'fixture');
    assert.equal(snapshot().collectionState, 'collected');
    fs.appendFileSync(index, 'invalid\n[]\n{}\n');
    assert.equal(snapshot().routerIndex, 'malformed');
    assert.equal(snapshot().sessions, 1);
    record.messages = -1;
    record.exported_at = '2026-09-15T12:00:00';
    record.markdown = '../outside.txt';
    fs.writeFileSync(path.join(root, 'outside.txt'), 'must not count');
    fs.writeFileSync(index, JSON.stringify(record));
    report = snapshot();
    assert.equal(report.sessionsWithUnknownMessageCount, 1);
    assert.equal(report.lastSuccessfulExport, null);
    assert.equal(report.localMarkdownBytes, 0);
    assert.equal(report.collectionState, 'attention_required');
    // An unreadable index must not be represented as zero collected sessions.
    fs.unlinkSync(index);
    fs.mkdirSync(index);
    assert.equal(snapshot().routerIndex, 'unreadable');
    assert.equal(snapshot().sessions, null);
    console.log('PASS: collection health states, counts, timestamps, containment, partial and unreadable indexes');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
