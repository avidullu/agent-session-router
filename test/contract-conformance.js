// Cross-repo output-contract conformance.
//
// Asserts this extension's renderer, filename stem, and router-index record
// reproduce the golden fixtures owned by the agent-sessions hub (vendored under
// test/fixtures/contract/, kept in sync with that repo's
// tests/fixtures/contract/). If these fail, the router has drifted from the
// hub's render.py — see the hub's docs/OUTPUT_CONTRACT.md.
//
// The `__SOURCE_FILE__` placeholder stands in for the environment-specific
// native source path, which the contract deliberately leaves un-normalized.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { renderMarkdown } = require('../out/renderers/markdown');
const { archiveStem, buildRouterIndexRecord, repoRelativeMarkdown } = require('../out/contract');

const PLACEHOLDER = '__SOURCE_FILE__';
const CONTRACT_DIR = path.join(__dirname, 'fixtures', 'contract', 'v1');

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

const cases = fs
    .readdirSync(CONTRACT_DIR)
    .filter((d) => fs.statSync(path.join(CONTRACT_DIR, d)).isDirectory())
    .sort();

console.log(`Output-contract conformance (${cases.length} fixtures):\n`);

if (cases.length === 0) {
    console.log('  FAIL: no contract fixtures found');
    process.exit(1);
}

for (const name of cases) {
    const dir = path.join(CONTRACT_DIR, name);
    const input = JSON.parse(fs.readFileSync(path.join(dir, 'input.json'), 'utf-8'));
    const expectedMd = fs.readFileSync(path.join(dir, 'expected.md'), 'utf-8');
    const expected = JSON.parse(fs.readFileSync(path.join(dir, 'expected.json'), 'utf-8'));

    const sourceFile = input.source_file_name;
    const session = { metadata: input.metadata, messages: input.messages };
    const ctx = {
        sourceName: input.source_name,
        sourceKind: input.source_kind,
        sourceFilePath: sourceFile,
        digest: input.sha256,
        sourceModifiedAt: expected.source_modified,
        importedAt: input.imported_at,
    };

    test(`${name}: markdown byte-for-byte`, () => {
        const rendered = renderMarkdown(session, ctx).split(sourceFile).join(PLACEHOLDER);
        assert.strictEqual(rendered, expectedMd);
    });

    test(`${name}: archive filename stem`, () => {
        const stem = archiveStem({
            sourceFilePath: sourceFile,
            sessionId: String(input.metadata.session_id || ''),
            digest: input.sha256,
            mtimeMs: input.mtime * 1000,
        });
        assert.strictEqual(stem, expected.stem);
    });

    test(`${name}: router-index record`, () => {
        const markdownRel = repoRelativeMarkdown('archive', input.source_name, expected.stem);
        const record = buildRouterIndexRecord({
            sourceName: input.source_name,
            sourceKind: input.source_kind,
            sourceFilePath: PLACEHOLDER,
            digest: input.sha256,
            sizeBytes: input.size,
            mtimeMs: input.mtime * 1000,
            messages: input.messages.length,
            markdownRel,
            metadata: input.metadata,
        });
        assert.deepStrictEqual(record, expected.router_index_record);
    });
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('Output contract: router matches the hub golden fixtures.');
