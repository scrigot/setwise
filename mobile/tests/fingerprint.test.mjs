import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFingerprintAsync } = require('expo/fingerprint');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('Expo fingerprints honor ignored files and explicit includes with the patched matcher', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(projectRoot, 'fingerprint-fixture-'));
  const relative = basename(directory);
  const options = {
    extraSources: [{ type: 'dir', filePath: relative, reasons: ['compatibility fixture'] }],
    ignorePaths: [`${relative}/**/*`, `!${relative}/keep.txt`],
  };
  try {
    await writeFile(join(directory, 'keep.txt'), 'included v1');
    await writeFile(join(directory, 'ignore.txt'), 'ignored v1');
    const before = await createFingerprintAsync(projectRoot, options);
    assert.ok(before.hash);
    assert.ok(before.sources.some(source => source.filePath === relative && source.hash));

    await writeFile(join(directory, 'ignore.txt'), 'ignored v2');
    const ignoredChange = await createFingerprintAsync(projectRoot, options);
    assert.equal(ignoredChange.hash, before.hash, 'ignored files must not change the native fingerprint');

    await writeFile(join(directory, 'keep.txt'), 'included v2');
    const includedChange = await createFingerprintAsync(projectRoot, options);
    assert.notEqual(includedChange.hash, before.hash, 'explicit includes must still affect the native fingerprint');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
