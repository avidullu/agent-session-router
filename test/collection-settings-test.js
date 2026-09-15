const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');
const { normalizeOutputPath } = require('../out/output-path');

async function main() {
    assert.equal(normalizeOutputPath('~/archive', 'linux', '/local'), '/local/archive');
    assert.equal(normalizeOutputPath('~', 'darwin', '/local'), '/local');
    assert.equal(normalizeOutputPath(' C:\\Users\\Avi\\archive ', 'win32'), 'C:\\Users\\Avi\\archive');
    assert.equal(normalizeOutputPath('\\\\server\\archive', 'win32'), '\\\\server\\archive\\');
    for (const value of ['C:\\Users\\Avi\\archive', 'C:\\\\Users\\\\Avi', '\\\\server\\archive', 'relative/archive']) {
        assert.throws(() => normalizeOutputPath(value, 'linux'), /absolute path on this machine/);
    }
    assert.throws(() => normalizeOutputPath('/home/avi/archive', 'win32'), /absolute path/);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-settings-'));
    const sourceDir = path.join(root, 'Code', 'User', 'workspaceStorage', 'fixture', 'chatSessions');
    fs.mkdirSync(sourceDir, { recursive: true });
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = root;
    const settings = { outputDir: path.join(root, 'archive'), 'watch.enabled': false, 'watch.debounceMs': 1 };
    const watchers = [];
    const warnings = [];
    const callbacks = [];
    const commands = new Map();
    const documents = [];
    const folderOpens = [];
    let closed = 0;
    let shown = 0;
    const channel = { appendLine() {}, clear() {}, show() { shown++; } };
    const vscode = {
        ConfigurationTarget: { Global: 1 },
        Uri: { file: fsPath => ({ fsPath }) },
        window: {
            createOutputChannel: () => channel,
            showInformationMessage: async () => undefined,
            showWarningMessage: async (message) => { warnings.push(message); },
            showTextDocument: async document => { documents.push(document.content); },
        },
        workspace: {
            openTextDocument: async document => document,
            getConfiguration: () => ({
                get: (key, fallback) => settings[key] ?? fallback,
                update: async (key, value) => { settings[key] = value; changed(key); },
            }),
            onDidChangeConfiguration: (callback) => { callbacks.push(callback); return { dispose() {} }; },
        },
        commands: {
            registerCommand: (name, callback) => { commands.set(name, callback); return { dispose() {} }; },
            executeCommand: async (name, ...args) => name === 'vscode.openFolder' ? folderOpens.push(args) : commands.get(name)?.(),
        },
    };
    function changed(key) {
        for (const callback of callbacks) callback({
            affectsConfiguration: (section) => section === 'agentSessionRouter' || section === `agentSessionRouter.${key}`,
        });
    }
    const originalLoad = Module._load;
    const chokidar = require('chokidar');
    const originalWatch = chokidar.watch;
    chokidar.watch = () => {
        const watcher = new EventEmitter();
        watcher.close = async () => { closed++; };
        watchers.push(watcher);
        return watcher;
    };
    Module._load = function (name, ...args) {
        if (name === 'vscode') return vscode;
        return originalLoad.call(this, name, ...args);
    };
    let extension;
    try {
        extension = require('../out/extension');
        const watcher = require('../out/watcher');
        const context = { subscriptions: [], logUri: { fsPath: path.join(root, 'logs') }, extension: { packageJSON: { version: '0.2.1' } } };
        extension.activate(context);
        await watcher.syncWatcher();
        assert.equal(watchers.length, 0, 'auto-export remains opt-in');
        assert.equal(shown, 0, 'activation must not open the Output panel over the user work');

        settings['watch.enabled'] = true;
        changed('watch.enabled');
        await Promise.all([watcher.syncWatcher(), watcher.syncWatcher()]);
        assert.equal(watchers.length, 1, 'settings changes start exactly one watcher without reload');

        const file = path.join(sourceDir, 'zai-fixture.jsonl');
        fs.writeFileSync(file, JSON.stringify({ kind: 0, v: { sessionId: 'zai-fixture', requests: [{
            modelId: 'zai/glm-5.3', message: { text: 'A fixture question' }, response: [{ value: 'A visible answer' }],
        }] } }) + '\n');
        watchers.at(-1).emit('change', file);
        await new Promise(resolve => setTimeout(resolve, 40));
        const archiveDir = path.join(settings.outputDir, 'zai-vscode');
        const output = fs.readdirSync(archiveDir).find(name => name.endsWith('.md'));
        assert.ok(fs.readFileSync(path.join(archiveDir, output), 'utf8').includes('A visible answer'));
        assert.ok(fs.existsSync(path.join(settings.outputDir, '.router-index.jsonl')));
        await commands.get('agentSessionRouter.collectionStatus')();
        assert.ok(documents.at(-1).includes('"watcherState": "watching"'));
        assert.ok(documents.at(-1).includes('"knownMessages": 2'));
        assert.ok(!documents.at(-1).includes('A visible answer'), 'health does not expose transcript bodies');
        await commands.get('agentSessionRouter.openArchive')();
        assert.equal(folderOpens.at(-1)[0].fsPath, settings.outputDir);
        assert.equal(folderOpens.at(-1)[1], true, 'archive opens separately from the active project');

        await commands.get('agentSessionRouter.watchStop')();
        assert.equal(watcher.isWatcherRunning(), false);
        assert.equal(closed, 1);
        settings.outputDir = process.platform === 'win32' ? '/home/foreign/archive' : 'C:\\foreign\\archive';
        changed('outputDir');
        await commands.get('agentSessionRouter.watchStart')();
        assert.equal(watcher.isWatcherRunning(), false, 'foreign paths block exports');
        assert.ok(warnings.some(message => message.includes('absolute path')));
        assert.ok(commands.has('agentSessionRouter.setOutputDir'), 'repair command stays available');
        await commands.get('agentSessionRouter.collectionStatus')();
        assert.ok(warnings.some(message => message.includes('Collection status unavailable')));
        await commands.get('agentSessionRouter.openArchive')();
        assert.ok(warnings.some(message => message.includes('Archive directory unavailable')));

        settings.outputDir = path.join(root, 'repaired');
        changed('outputDir');
        await watcher.syncWatcher();
        assert.equal(watcher.isWatcherRunning(), true, 'repair resumes collection without reload');
        settings.enabled = false;
        changed('enabled');
        await watcher.syncWatcher();
        assert.equal(watcher.isWatcherRunning(), false);
        settings.enabled = true;
        changed('enabled');
        await watcher.syncWatcher();
        await extension.deactivate();
        assert.equal(watcher.isWatcherRunning(), false, 'deactivation closes watchers');
        console.log('Collection settings: PASS (path portability, activation, live settings, Z.ai export, recovery, shutdown)');
    } finally {
        if (extension) await extension.deactivate();
        Module._load = originalLoad;
        chokidar.watch = originalWatch;
        if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = previousXdg;
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
