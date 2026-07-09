/**
 * End-to-End Regression Gate: agent-session-router → Agent Sessions ingestion
 *
 * Verifies that the Python agent-archive tool correctly ingests .router-index.jsonl
 * files produced by the VS Code extension. Designed to be run:
 *   - On developer machines with real VS Code agent session data
 *   - As a CI regression gate (skips if no VS Code data or Python tool unavailable)
 *
 * Usage:
 *   node test/e2e-regression-gate.js
 *
 * Exit codes:
 *   0 — all checks passed or gracefully skipped
 *   1 — test failure
 *   2 — skipped (no data available, not an error)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// ── Configuration ──────────────────────────────────────────────────
const AGENT_SESSIONS_REPO = path.join(os.homedir(), 'Projects', 'Agent Sessions');
const TIMEOUT_MS = 60_000;

// ── Test state ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;
const tmpDirs = [];

function test(name, fn) {
    try { fn(); passed++; console.log(`  PASS: ${name}`); }
    catch (err) { failed++; console.log(`  FAIL: ${name}\n        ${err.message}`); }
}

function skip(name, reason) {
    skipped++;
    console.log(`  SKIP: ${name} (${reason})`);
}

function cleanup() {
    for (const dir of tmpDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
}

function copyDirIfExists(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirIfExists(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────
function isCi() {
    return !!(process.env.CI || process.env.GITHUB_ACTIONS);
}

function hasVsCodeData() {
    const appData = process.env.APPDATA || '';
    const dsDir = path.join(appData, 'Code', 'User', 'globalStorage',
        'vizards.deepseek-v4-for-copilot', 'request-dumps');
    const wsDir = path.join(appData, 'Code', 'User', 'workspaceStorage');
    return fs.existsSync(dsDir) || fs.existsSync(wsDir);
}

function hasPythonTool() {
    const toolPath = path.join(AGENT_SESSIONS_REPO, 'tools', 'agent_archive.py');
    return fs.existsSync(toolPath);
}

function runPython(args, cwd, timeout = TIMEOUT_MS) {
    return execSync(`python tools/agent_archive.py ${args}`, {
        cwd,
        encoding: 'utf-8',
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

// ── Extension helpers (load compiled modules) ──────────────────────
function loadExtensionModules() {
    const extOutDir = path.join(__dirname, '..', 'out');
    if (!fs.existsSync(extOutDir)) {
        throw new Error('Extension not compiled. Run: npx tsc -p ./');
    }
    require(path.join(extOutDir, 'discoverers', 'deepseek'));
    require(path.join(extOutDir, 'discoverers', 'copilot-chat'));
    const { getDiscoverer } = require(path.join(extOutDir, 'discoverers', 'index'));
    require(path.join(extOutDir, 'extractors', 'deepseek'));
    require(path.join(extOutDir, 'extractors', 'copilot-chat'));
    const { getExtractor } = require(path.join(extOutDir, 'extractors', 'index'));
    const { renderMarkdown } = require(path.join(extOutDir, 'renderers', 'markdown'));
    const { sha256File, slugify } = require(path.join(extOutDir, 'utils'));
    return { getDiscoverer, getExtractor, renderMarkdown, sha256File, slugify };
}

async function discoverSessions(ext, kind, limit = 1) {
    const discoverer = ext.getDiscoverer(kind);
    if (!discoverer) return [];
    const sessions = [];
    for await (const s of discoverer()) {
        sessions.push(s);
        if (sessions.length >= limit) break;
    }
    return sessions;
}

// ── Main test ──────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  E2E Regression Gate                      ║');
    console.log('║  Extension → Agent Sessions Ingestion     ║');
    console.log('╚══════════════════════════════════════════╝\n');

    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(1); });

    // ── Pre-flight checks ──
    if (isCi()) {
        skip('pre-flight', 'CI environment — no VS Code agent data available');
        console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        process.exit(2);
    }

    if (!hasVsCodeData()) {
        skip('pre-flight', 'no VS Code agent session data found on this machine');
        console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        process.exit(2);
    }

    if (!hasPythonTool()) {
        skip('pre-flight', `Agent Sessions repo not found at ${AGENT_SESSIONS_REPO}`);
        console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        process.exit(2);
    }

    // ── Load extension modules ──
    let ext;
    try {
        ext = loadExtensionModules();
    } catch (err) {
        skip('pre-flight', `Extension not compiled: ${err.message}`);
        console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        process.exit(2);
    }

    console.log('─── Step 1: Discover real sessions ───');

    const copilotSessions = await discoverSessions(ext, 'copilot_chat', 1);
    const dsSessions = await discoverSessions(ext, 'deepseek_request_dump', 1);

    if (copilotSessions.length === 0 && dsSessions.length === 0) {
        skip('discovery', 'no Copilot Chat or DeepSeek sessions found');
        console.log(`\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped`);
        process.exit(2);
    }

    test('Discovered real sessions', () => {
        const total = copilotSessions.length + dsSessions.length;
        if (total === 0) throw new Error('No sessions');
        console.log(`         Copilot: ${copilotSessions.length}, DeepSeek: ${dsSessions.length}`);
    });

    // ── Step 2: Create temp archive ──
    console.log('\n─── Step 2: Set up temp archive ───');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-agent-sessions-'));
    tmpDirs.push(tmpDir);
    const archiveDir = path.join(tmpDir, 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });

    // Copy default_sources.toml for config
    const configSrc = path.join(AGENT_SESSIONS_REPO, 'config', 'default_sources.toml');
    const configDir = path.join(tmpDir, 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(configSrc, path.join(configDir, 'default_sources.toml'));

    // Copy the Agent Sessions tooling into temp dir for export
    const toolsDir = path.join(tmpDir, 'tools');
    const agentSessionsDir = path.join(tmpDir, 'agent_sessions');
    copyDirIfExists(path.join(AGENT_SESSIONS_REPO, 'tools'), toolsDir);
    copyDirIfExists(path.join(AGENT_SESSIONS_REPO, 'agent_sessions'), agentSessionsDir);
    // Also need pyproject.toml for package resolution
    const pyprojectSrc = path.join(AGENT_SESSIONS_REPO, 'pyproject.toml');
    if (fs.existsSync(pyprojectSrc)) {
        fs.copyFileSync(pyprojectSrc, path.join(tmpDir, 'pyproject.toml'));
    }

    test('Temp archive ready with tooling', () => {
        if (!fs.existsSync(toolsDir)) throw new Error('tools/ not copied');
        console.log(`         ${tmpDir}`);
    });

    // ── Step 3: Extract, render, write Markdown + .router-index.jsonl ──
    console.log('\n─── Step 3: Generate Markdown + .router-index.jsonl ───');

    const routerRecords = [];
    const allSessions = [...copilotSessions, ...dsSessions];

    for (const session of allSessions) {
        const extractor = ext.getExtractor(session.sourceKind);
        const extracted = extractor(session.filePath);
        const digest = ext.sha256File(session.filePath);

        const sourceDir = path.join(archiveDir, ext.slugify(session.sourceName));
        const sessionFile = ext.slugify(
            String(extracted.metadata.session_id || session.sessionId)
        );
        const mdPath = path.join(sourceDir, `${sessionFile}.md`);

        const md = ext.renderMarkdown(extracted, {
            sourceName: session.sourceName,
            sourceKind: session.sourceKind,
            sourceFilePath: session.filePath,
            digest,
            sourceModifiedAt: new Date(session.mtimeMs).toISOString(),
        });

        fs.mkdirSync(sourceDir, { recursive: true });
        fs.writeFileSync(mdPath, md, 'utf-8');

        routerRecords.push({
            source: session.sourceName,
            kind: session.sourceKind,
            source_file: session.filePath,
            sha256: digest,
            size: session.sizeBytes,
            mtime: session.mtimeMs,
            messages: extracted.messages.length,
            markdown: `archive/${ext.slugify(session.sourceName)}/${sessionFile}.md`,
            metadata: extracted.metadata,
        });
    }

    const routerIndexPath = path.join(archiveDir, '.router-index.jsonl');
    const jsonlContent = routerRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(routerIndexPath, jsonlContent, 'utf-8');

    test('Markdown files written', () => {
        for (const rec of routerRecords) {
            const fullPath = path.join(tmpDir, rec.markdown);
            if (!fs.existsSync(fullPath)) throw new Error(`Missing: ${fullPath}`);
        }
        console.log(`         ${routerRecords.length} Markdown files`);
    });

    test('.router-index.jsonl written', () => {
        if (!fs.existsSync(routerIndexPath)) throw new Error('File not created');
        const content = fs.readFileSync(routerIndexPath, 'utf-8');
        const entries = content.split('\n').filter(l => l.trim());
        if (entries.length !== routerRecords.length) {
            throw new Error(`Expected ${routerRecords.length} entries, got ${entries.length}`);
        }
        console.log(`         ${entries.length} entries`);
    });

    // ── Step 4: Python merge (run from Agent Sessions repo) ──
    console.log('\n─── Step 4: Python merge router records ──');

    // Write the merge script to a temp file to avoid quoting issues
    const mergeScript = path.join(tmpDir, '_merge_router.py');
    const mergeScriptContent = `
import sys, json
sys.path.insert(0, r'${AGENT_SESSIONS_REPO}')
from pathlib import Path
from agent_sessions.archive import read_router_index_records, merge_index_records, write_indexes
from agent_sessions.config import ArchiveConfig

config = ArchiveConfig(
    repo_root=Path(r'${tmpDir}'),
    archive_dir=Path(r'${tmpDir}') / 'archive',
    raw_dir=Path(r'${tmpDir}') / 'raw',
    sources=(),
)
router_records = read_router_index_records(config)
if router_records:
    existing = []
    index_path = config.archive_dir / 'index.jsonl'
    if index_path.exists():
        for line in index_path.read_text().splitlines():
            if line.strip():
                try: existing.append(json.loads(line))
                except: pass
    merged = merge_index_records(existing, router_records)
    write_indexes(config, merged)
    print(f'Merged {len(router_records)} router records into index ({len(merged)} total)')
else:
    print('No router records to merge')
`;
    fs.writeFileSync(mergeScript, mergeScriptContent, 'utf-8');

    try {
        const result = execSync(`python "${mergeScript}"`, {
            cwd: AGENT_SESSIONS_REPO,
            encoding: 'utf-8',
            timeout: 15000,
        });
        test('Python merge succeeds', () => {
            const output = result.trim();
            if (!output) throw new Error('No output from merge script');
            console.log(`         ${output}`);
        });
    } catch (err) {
        const stderr = err.stderr || '';
        test('Python merge succeeds', () => {
            throw new Error(`Merge failed: ${stderr.slice(0, 500)}`);
        });
    }

    // ── Step 5: Verify index.jsonl includes router sessions ──
    console.log('\n─── Step 5: Verify final index ───');

    const indexPath = path.join(archiveDir, 'index.jsonl');

    test('index.jsonl includes router-produced sources', () => {
        if (!fs.existsSync(indexPath)) throw new Error('index.jsonl was not created');

        const content = fs.readFileSync(indexPath, 'utf-8');
        const sources = new Set();
        for (const line of content.split('\n').filter(l => l.trim())) {
            try {
                const record = JSON.parse(line);
                sources.add(record.source);
            } catch {}
        }

        for (const rec of routerRecords) {
            if (!sources.has(rec.source)) {
                throw new Error(`${rec.source} not found in index.jsonl. Sources: ${[...sources].join(', ')}`);
            }
            console.log(`         ${rec.source}: ✅ indexed (${rec.messages} messages)`);
        }
    });

    test('index.jsonl entries have required fields', () => {
        const content = fs.readFileSync(indexPath, 'utf-8');
        for (const line of content.split('\n').filter(l => l.trim())) {
            const rec = JSON.parse(line);
            if (!rec.source) throw new Error(`Missing source: ${line.slice(0, 100)}`);
            if (!rec.sha256) throw new Error(`Missing sha256: ${line.slice(0, 100)}`);
            if (rec.messages === undefined) throw new Error(`Missing messages: ${line.slice(0, 100)}`);
            if (!rec.markdown) throw new Error(`Missing markdown: ${line.slice(0, 100)}`);
        }
        console.log(`         All entries valid`);
    });

    // ── Summary ──
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
    console.log(`Temp archive: ${tmpDir}`);

    if (failed > 0) {
        console.log('\nSOME TESTS FAILED — check output above');
        console.log(`Temp archive preserved for debugging: ${tmpDir}`);
        // Don't clean up on failure — preserve artifacts
        tmpDirs.length = 0;
        process.exit(1);
    }

    console.log('E2E Regression Gate PASSED! 🎉');
    cleanup();
    process.exit(0);
}

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
