/**
 * Real-world integration test — exercises the agent-session-router
 * against the ACTUAL VS Code installation on this machine.
 *
 * Tests:
 *   1. DeepSeek session discovery + extraction + rendering
 *   2. Copilot Chat session discovery + extraction + rendering
 *   3. Output validation
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Import discoverers (triggers side-effect registration)
require('../out/discoverers/deepseek');
require('../out/discoverers/copilot-chat');
const { getDiscoverer } = require('../out/discoverers/index');

// Import extractors
require('../out/extractors/deepseek');
require('../out/extractors/copilot-chat');
const { getExtractor } = require('../out/extractors/index');

const { renderMarkdown } = require('../out/renderers/markdown');
const { sha256File, slugify } = require('../out/utils');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  PASS: ${name}`);
        passed++;
    } catch (err) {
        console.log(`  FAIL: ${name}`);
        console.log(`        ${err.message}`);
        failed++;
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  Real-World Integration Test             ║');
    console.log('║  Agent Session Router v0.1.0             ║');
    console.log('╚══════════════════════════════════════════╝\n');

    // ---- 1. DeepSeek Discovery ----
    console.log('─── DeepSeek V4 ───');
    const deepseekDiscoverer = getDiscoverer('deepseek_request_dump');
    if (!deepseekDiscoverer) {
        console.log('  SKIP: No DeepSeek discoverer registered');
    } else {
        const dsSessions = [];
        for await (const s of deepseekDiscoverer()) {
            dsSessions.push(s);
        }

        test(`DeepSeek: discoverer found sessions`, () => {
            if (dsSessions.length === 0) throw new Error('No DeepSeek sessions found on this machine');
            console.log(`         ${dsSessions.length} sessions discovered`);
        });

        if (dsSessions.length > 0) {
            const sample = dsSessions[0];
            console.log(`         Sample: ${sample.sessionId}`);
            console.log(`         Source: ${sample.filePath}`);
            console.log(`         Size: ${(sample.sizeBytes / 1024).toFixed(1)} KB`);

            // Extract
            const dsExtractor = getExtractor('deepseek_request_dump');
            test(`DeepSeek: extractor registered`, () => {
                if (!dsExtractor) throw new Error('Extractor not registered');
            });

            if (dsExtractor) {
                const extracted = dsExtractor(sample.filePath);
                test(`DeepSeek: extraction produces messages`, () => {
                    if (extracted.messages.length === 0) throw new Error('Zero messages extracted');
                    console.log(`         ${extracted.messages.length} messages extracted`);
                });

                test(`DeepSeek: metadata includes session_id`, () => {
                    if (!extracted.metadata.session_id) throw new Error('Missing session_id');
                });

                // Show message role distribution
                const roles = {};
                for (const m of extracted.messages) {
                    roles[m.role] = (roles[m.role] || 0) + 1;
                }
                console.log(`         Roles: ${JSON.stringify(roles)}`);

                // Render and validate
                const digest = sha256File(sample.filePath);
                const md = renderMarkdown(extracted, {
                    sourceName: sample.sourceName,
                    sourceKind: sample.sourceKind,
                    sourceFilePath: sample.filePath,
                    digest,
                    sourceModifiedAt: new Date(sample.mtimeMs).toISOString(),
                });

                test(`DeepSeek: Markdown has heading`, () => {
                    if (!md.startsWith('# ')) throw new Error('Missing heading');
                });
                test(`DeepSeek: Markdown has Metadata`, () => {
                    if (!md.includes('## Metadata')) throw new Error('Missing Metadata section');
                });
                test(`DeepSeek: Markdown has Transcript`, () => {
                    if (!md.includes('## Transcript')) throw new Error('Missing Transcript section');
                });
                test(`DeepSeek: Markdown has SHA-256`, () => {
                    if (!md.includes(digest)) throw new Error('Missing digest');
                });

                // Write sample output
                const outDir = path.join(os.tmpdir(), 'agent-router-realworld-test');
                fs.mkdirSync(outDir, { recursive: true });
                const outPath = path.join(outDir, 'deepseek-sample.md');
                fs.writeFileSync(outPath, md);
                console.log(`         Output: ${outPath} (${(Buffer.byteLength(md) / 1024).toFixed(1)} KB)`);

                // Show first few lines
                const preview = md.split('\n').slice(0, 15).join('\n');
                console.log(`         Preview:\n${preview}\n`);
            }
        }
    }

    // ---- 2. Copilot Chat Discovery ----
    console.log('─── Copilot Chat ───');
    const copilotDiscoverer = getDiscoverer('copilot_chat');
    if (!copilotDiscoverer) {
        console.log('  SKIP: No Copilot Chat discoverer registered');
    } else {
        const ccSessions = [];
        for await (const s of copilotDiscoverer()) {
            ccSessions.push(s);
        }

        // Separate transcript vs debug-log sources
        const transcriptSessions = ccSessions.filter(s => s.filePath.includes('transcripts'));
        const debugLogSessions = ccSessions.filter(s => s.filePath.includes('debug-logs'));

        test(`Copilot: discoverer found sessions`, () => {
            if (ccSessions.length === 0) throw new Error('No Copilot Chat sessions found');
            console.log(`         ${ccSessions.length} total sessions`);
            console.log(`         ${transcriptSessions.length} from transcripts/`);
            console.log(`         ${debugLogSessions.length} from debug-logs/`);
        });

        if (ccSessions.length > 0) {
            // Prefer a transcript session for testing
            const sample = transcriptSessions[0] || ccSessions[0];
            console.log(`         Sample: ${sample.sessionId}`);
            console.log(`         Source: ${sample.filePath}`);
            console.log(`         Size: ${(sample.sizeBytes / 1024).toFixed(1)} KB`);

            const ccExtractor = getExtractor('copilot_chat');
            test(`Copilot: extractor registered`, () => {
                if (!ccExtractor) throw new Error('Extractor not registered');
            });

            if (ccExtractor) {
                const startTime = Date.now();
                const extracted = ccExtractor(sample.filePath);
                const extractMs = Date.now() - startTime;

                test(`Copilot: extraction produces messages`, () => {
                    if (extracted.messages.length === 0) throw new Error('Zero messages extracted');
                    console.log(`         ${extracted.messages.length} messages in ${extractMs}ms`);
                });

                test(`Copilot: metadata has session_id`, () => {
                    if (!extracted.metadata.session_id) throw new Error('Missing session_id');
                });

                // Show message role distribution
                const roles = {};
                for (const m of extracted.messages) {
                    roles[m.role] = (roles[m.role] || 0) + 1;
                }
                console.log(`         Roles: ${JSON.stringify(roles)}`);

                // Check for tool output cross-referencing
                const toolWithOutput = extracted.messages.filter(m =>
                    m.role === 'tool' && m.text.includes('Tool result:'));
                console.log(`         Tool results with output: ${toolWithOutput.length}`);

                // Show copilot version if present
                if (extracted.metadata.copilot_version) {
                    console.log(`         Copilot version: ${extracted.metadata.copilot_version}`);
                }
                if (extracted.metadata.vscode_version) {
                    console.log(`         VS Code version: ${extracted.metadata.vscode_version}`);
                }

                // Render
                const digest = sha256File(sample.filePath);
                const md = renderMarkdown(extracted, {
                    sourceName: sample.sourceName,
                    sourceKind: sample.sourceKind,
                    sourceFilePath: sample.filePath,
                    digest,
                    sourceModifiedAt: new Date(sample.mtimeMs).toISOString(),
                });

                test(`Copilot: Markdown valid`, () => {
                    if (!md.startsWith('# ')) throw new Error('Missing heading');
                    if (!md.includes('## Transcript')) throw new Error('Missing transcript');
                });

                // Write sample output
                const outDir = path.join(os.tmpdir(), 'agent-router-realworld-test');
                fs.mkdirSync(outDir, { recursive: true });
                const outPath = path.join(outDir, 'copilot-sample.md');
                fs.writeFileSync(outPath, md);
                console.log(`         Output: ${outPath} (${(Buffer.byteLength(md) / 1024).toFixed(1)} KB)`);

                // Show first few lines
                const preview = md.split('\n').slice(0, 15).join('\n');
                console.log(`         Preview:\n${preview}\n`);
            }
        }
    }

    // ---- Summary ----
    console.log('═'.repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
        console.log('SOME TESTS FAILED — check output above');
        process.exit(1);
    }
    console.log('All real-world integration tests passed!');
    console.log(`Sample output: ${path.join(os.tmpdir(), 'agent-router-realworld-test')}`);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
