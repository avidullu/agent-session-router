// Fail before publication if a tag would label a different package version.
const { version } = require('../package.json');
const expected = `v${version}`;
if (!/^\d+\.\d+\.\d+$/.test(version) || process.env.GITHUB_REF_NAME !== expected) {
    console.error(`Release refused: expected final-version tag ${expected}.`);
    process.exit(1);
}
console.log(`Release tag matches package version ${version}.`);
