// Offline: exercise the checkout's real storage and extension export functions.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

assert.ok(process.env.MARINARA_REPO, 'Set MARINARA_REPO to an existing checkout');
const root = resolve(process.env.MARINARA_REPO);
const require = createRequire(join(root, 'packages/client/package.json'));
const { build } = require('esbuild');
const source = `
export { createPersonalExtensionPackageFiles } from ${JSON.stringify(join(root, 'packages/client/src/lib/personal-extension-transfer.ts'))};
export { createPersonalExtensionSettingsStorage } from ${JSON.stringify(join(root, 'packages/server/src/services/extensions/personal-extension-settings.service.ts'))};`;
const result = await build({
  stdin: { contents: source, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { '@marinara-engine/shared': join(root, 'packages/shared/src/index.ts') }, logLevel: 'silent',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const rows = new Map();
const store = api.createPersonalExtensionSettingsStorage({
  get: async key => rows.get(key) ?? null,
  set: async (key, value) => rows.set(key, value),
  remove: async key => rows.delete(key),
});
const sentinel = 'offline-export-sentinel-not-a-real-key';
await store.patch('fixture', { apiKey: sentinel, rememberKey: true });
assert.equal((await store.get('fixture')).apiKey === sentinel, true);
assert.equal([...rows.values()][0].includes(sentinel), true, 'storage is plaintext JSON');
const files = api.createPersonalExtensionPackageFiles({
  name: 'PixAI Illustrator Bridge', version: '0.1.3', description: '', runtime: 'client',
  capabilities: ['full_page_access'], js: readFileSync(new URL('../extension.js', import.meta.url), 'utf8'), css: '',
  storage: await store.get('fixture'), apiKey: sentinel,
});
assert.equal(JSON.stringify(files).includes(sentinel), false, 'extension export excludes stored credentials');
await store.patch('fixture', { apiKey: '', rememberKey: false });
assert.equal([...rows.values()][0].includes(sentinel), false, 'deletion clears the current stored value');
console.log('PASS actual Engine storage: plaintext round-trip/deletion; extension ZIP export excludes credential sentinel (offline, no data directory access)');
