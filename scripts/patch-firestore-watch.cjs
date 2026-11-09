/* eslint-disable @typescript-eslint/no-require-imports -- npm install hook runs directly in CommonJS. */
const fs = require('node:fs');
const path = require('node:path');
// Firestore 7.11.6 leaves the old idle timer alive while reconnecting. It can
// race the pending backoff, close the watch and discard its resume token.
const file = require.resolve('@google-cloud/firestore/build/src/watch.js');
const version = require('@google-cloud/firestore/package.json').version;
const marker = '// YouAnalyst: cancel the previous stream idle timer before reconnect.';
const original = '    initStream() {\n        this.backoff';
const replacement = `    initStream() {\n        ${marker}\n        if (this.idleTimeoutHandle) {\n            clearTimeout(this.idleTimeoutHandle);\n            this.idleTimeoutHandle = undefined;\n        }\n        this.backoff`;
const source = fs.readFileSync(file, 'utf8');
if (version !== '7.11.6') throw new Error(`Review Firestore watch fix before changing SDK version: ${version}`);
if (!source.includes(marker)) {
  if (source.split(original).length !== 2) throw new Error('Unexpected Firestore watch source; refusing an unverified patch');
  fs.writeFileSync(file, source.replace(original, replacement));
}
console.log(`Firestore watch idle-timer fix verified (${version}, ${path.basename(file)})`);

