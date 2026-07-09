// Unit tests for export outcome classification.

const assert = require('assert');
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
