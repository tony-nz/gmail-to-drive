// Build a Chrome Web Store upload zip from dist/, with the `key` field removed.
// The Store assigns its own extension ID and rejects manifests containing a
// `key` (which we keep in source only for stable local/unpacked dev installs).
const fs = require('fs');
const { execSync } = require('child_process');

const STAGE = '.store-build';
const ZIP = 'gmail2drive.zip';

execSync(`rm -rf ${STAGE} && cp -r dist ${STAGE}`);

const manifestPath = `${STAGE}/manifest.json`;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
delete manifest.key;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

execSync(`rm -f ${ZIP} && cd ${STAGE} && zip -rq ../${ZIP} . && cd ..`);
execSync(`rm -rf ${STAGE}`);

console.log(`Created ${ZIP} for the Chrome Web Store (key field removed).`);
