// Unit tests for export outcome classification.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function test(name, fn) {
    return Promise.resolve()
        .then(fn)
        .then(() => {
            passed++;
            console.log(`  PASS: ${name}`);
        })
        .catch((err) => {
            failed++;
            console.log(`  FAIL: ${name}`);
            console.log(`        ${err.message}`);
        });
}

function withVscodeStub(fn) {
    const originalLoad = Module._load;
    Module._load = function load(request, parent, isMain) {
        if (request === 'vscode') {
            return {
                ProgressLocation: { Notification: 15 },
                window: {
                    createOutputChannel: () => ({
                        appendLine: () => undefined,
                        clear: () => undefined,
                        show: () => undefined,
                    }),
                    showInformationMessage: () => undefined,
                    showWarningMessage: () => undefined,
                },
                workspace: {
                    getConfiguration: () => ({
                        get: (_key, fallback) => fallback,
                    }),
                },
            };
        }
        return originalLoad.apply(this, [request, parent, isMain]);
    };
    try {
        return fn();
    } finally {
        Module._load = originalLoad;
    }
}

function makeSession(tmpDir, name, sourceKind) {
    const filePath = path.join(tmpDir, `${name}.jsonl`);
    fs.writeFileSync(filePath, `{"ok":true,"name":"${name}"}\n`, 'utf-8');
    const stat = fs.statSync(filePath);
    return {
        sourceName: 'coverage-router',
        sourceKind,
        filePath,
        sessionId: name,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
    };
}

(async () => {
    console.log('Router export outcomes:\n');

    await withVscodeStub(async () => {
        const { registerExtractor } = require('../out/extractors/index');
        const router = require('../out/router');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'router-outcomes-'));
        const outputDir = path.join(tmpDir, 'archive');

        registerExtractor('coverage_success', () => ({
            metadata: { session_id: 'success-1' },
            messages: [{ role: 'user', text: 'hello' }],
        }));
        registerExtractor('coverage_empty', () => ({
            metadata: { session_id: 'empty-1' },
            messages: [],
        }));
        registerExtractor('coverage_throw', () => {
            throw new Error('boom');
        });
        registerExtractor('coverage_multistore', (_filePath, sessionId) => ({
            metadata: { session_id: sessionId },
            messages: [{ role: 'user', text: `hello ${sessionId}` }],
            sourceDigest: crypto.createHash('sha256').update(String(sessionId)).digest('hex'),
        }));

        await test('output resolution accepts an explicit Agent Sessions checkout', async () => {
            const previous = process.env.AGENT_SESSIONS_HOME;
            process.env.AGENT_SESSIONS_HOME = path.join(tmpDir, 'hub');
            try {
                assert.strictEqual(
                    router.resolveOutputDir({ outputDir: '' }),
                    path.join(tmpDir, 'hub', 'archive'),
                );
            } finally {
                if (previous === undefined) delete process.env.AGENT_SESSIONS_HOME;
                else process.env.AGENT_SESSIONS_HOME = previous;
            }
        });

        await test('successful exports are counted as exported', async () => {
            router.resetExportCache();
            const outcome = await router.exportSessionWithOutcome(
                makeSession(tmpDir, 'success-1', 'coverage_success'),
                outputDir,
            );
            assert.strictEqual(outcome.status, 'exported');
            assert.ok(outcome.record);
            assert.ok(fs.existsSync(outcome.record.markdownPath));
        });

        await test('unchanged cached records are counted as skipped', async () => {
            router.resetExportCache();
            const session = makeSession(tmpDir, 'cached-1', 'coverage_success');
            const first = await router.exportSessionWithOutcome(session, outputDir);
            const second = await router.exportSessionWithOutcome(session, outputDir);
            assert.strictEqual(first.status, 'exported');
            assert.strictEqual(second.status, 'skipped');
            assert.ok(second.record);
        });

        await test('same-size same-mtime tail changes are re-exported', async () => {
            router.resetExportCache();
            const session = makeSession(tmpDir, 'tail-1', 'coverage_success');
            const first = await router.exportSessionWithOutcome(session, outputDir);
            fs.writeFileSync(session.filePath, '{"ok":true,"name":"tail-2"}\n', 'utf-8');
            fs.utimesSync(session.filePath, session.mtimeMs / 1000, session.mtimeMs / 1000);
            const second = await router.exportSessionWithOutcome(session, outputDir);
            assert.strictEqual(first.status, 'exported');
            assert.strictEqual(second.status, 'exported');
            assert.notStrictEqual(first.record.digest, second.record.digest);
        });

        await test('multi-session stores use independent cache identities', async () => {
            router.resetExportCache();
            const firstSession = makeSession(tmpDir, 'shared-store', 'coverage_multistore');
            firstSession.sessionId = 'session-a';
            firstSession.sourceRevision = 'revision-a';
            const secondSession = { ...firstSession, sessionId: 'session-b', sourceRevision: 'revision-b' };

            const first = await router.exportSessionWithOutcome(firstSession, outputDir);
            const second = await router.exportSessionWithOutcome(secondSession, outputDir);
            const firstAgain = await router.exportSessionWithOutcome(firstSession, outputDir);

            assert.strictEqual(first.status, 'exported');
            assert.strictEqual(second.status, 'exported');
            assert.notStrictEqual(first.record.markdownPath, second.record.markdownPath);
            assert.strictEqual(firstAgain.status, 'skipped');
        });

        await test('a changed logical revision invalidates a shared-store cache entry', async () => {
            router.resetExportCache();
            const session = makeSession(tmpDir, 'revision-store', 'coverage_multistore');
            session.sessionId = 'session-revision';
            session.sourceRevision = 'revision-1';
            const first = await router.exportSessionWithOutcome(session, outputDir);
            const second = await router.exportSessionWithOutcome(
                { ...session, sourceRevision: 'revision-2' },
                outputDir,
            );
            assert.strictEqual(first.status, 'exported');
            assert.strictEqual(second.status, 'exported');
        });

        await test('single-session exports update the router sidecar', async () => {
            router.resetExportCache();
            const session = makeSession(tmpDir, 'sidecar-1', 'coverage_success');
            const record = await router.exportSession(session, outputDir);
            assert.ok(record);
            const indexPath = path.join(outputDir, '.router-index.jsonl');
            assert.ok(fs.existsSync(indexPath));
            const records = fs
                .readFileSync(indexPath, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
            assert.ok(records.some((item) => item.metadata.session_id === 'success-1'));
        });

        await test('empty extracted sessions are counted as skipped', async () => {
            router.resetExportCache();
            const outcome = await router.exportSessionWithOutcome(
                makeSession(tmpDir, 'empty-1', 'coverage_empty'),
                outputDir,
            );
            assert.strictEqual(outcome.status, 'skipped');
            assert.strictEqual(outcome.record, null);
        });

        await test('missing extractors are counted as skipped', async () => {
            router.resetExportCache();
            const outcome = await router.exportSessionWithOutcome(
                makeSession(tmpDir, 'missing-1', 'coverage_missing'),
                outputDir,
            );
            assert.strictEqual(outcome.status, 'skipped');
            assert.strictEqual(outcome.record, null);
        });

        await test('extractor exceptions are counted as failed', async () => {
            router.resetExportCache();
            const outcome = await router.exportSessionWithOutcome(
                makeSession(tmpDir, 'throw-1', 'coverage_throw'),
                outputDir,
            );
            assert.strictEqual(outcome.status, 'failed');
            assert.strictEqual(outcome.record, null);
        });

        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    console.log('\n========================================');
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
})();
