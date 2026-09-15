const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

assert.equal(pkg.version, lock.version);
assert.equal(pkg.version, lock.packages[''].version);
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.ok(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').includes(`## ${pkg.version} —`));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
for (const command of ['agentSessionRouter.collectionStatus', 'agentSessionRouter.openArchive']) {
    const item = pkg.contributes.commands.find(item => item.command === command);
    assert.ok(item);
    assert.ok(pkg.activationEvents.includes(`onCommand:${command}`));
    assert.ok(readme.includes(item.title.replace('Agent Session Router: ', '')));
}
for (const [tag, expected] of [[`v${pkg.version}`, 0], ['v0.0.0', 1], ['', 1], [`v${pkg.version}-rc.1`, 1]]) {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/check-release-tag.js')], {
        env: { ...process.env, GITHUB_REF_NAME: tag }, encoding: 'utf8',
    });
    assert.equal(result.status, expected, result.stderr);
}
const workflow = fs.readFileSync(path.join(root, '.github/workflows/publish.yml'), 'utf8');
assert.ok(workflow.includes("    if: github.server_url == 'https://github.com'"));
assert.ok(workflow.indexOf('node scripts/check-release-tag.js') < workflow.indexOf('npx @vscode/vsce publish'));
console.log('Release metadata, command listing, publisher origin and 4 tag cases: PASS');
