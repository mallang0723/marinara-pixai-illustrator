#!/usr/bin/env node
// Offline-only: execute the checkout's real import normalizer and Zod schemas.
// Usage: node agent/validate-agent.mjs /path/to/Marinara-Engine
// Uses existing esbuild from that checkout. Installs nothing, writes nothing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const engine = process.argv[2];
assert.ok(engine, 'Pass the path to an existing Marinara-Engine checkout');
const root = resolve(engine);
const require = createRequire(join(root, 'packages/client/package.json'));
const { build } = require('esbuild');
const shared = join(root, 'packages/shared/src/index.ts');
const transfer = join(root, 'packages/client/src/lib/agent-transfer.ts');
const source = `export { normalizeAgentImportEntry, sanitizeAgentSettingsForImport } from ${JSON.stringify(transfer)};
export { getFolderImportEntries, createAgentConfigSchema, importAgentConfigSchema, CUSTOM_AGENT_CAPABILITY_IDS, normalizeCustomAgentCapabilities, normalizeCustomAgentContextSources } from ${JSON.stringify(shared)};`;
const result = await build({
  stdin: { contents: source, resolveDir: root, sourcefile: 'offline-agent-validator.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  alias: { '@marinara-engine/shared': shared }, logLevel: 'silent',
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const artifactPath = join(here, 'pixai-director.agent.json');
const bytes = readFileSync(artifactPath);
const artifact = JSON.parse(bytes);
const entries = api.getFolderImportEntries(artifact, ['agents']);
assert.equal(entries.length, 1);
const normalized = api.normalizeAgentImportEntry(entries[0], () => null);
assert.ok(normalized);
const { requestedCapabilities, ...agent } = normalized;
api.createAgentConfigSchema.parse(agent);
api.importAgentConfigSchema.parse({ agent, source: 'file', approvedCapabilities: [], acknowledgePermissions: true });
console.log('PASS actual getFolderImportEntries + normalizeAgentImportEntry + create/import Zod schemas');
assert.equal(agent.name, 'PixAI Director');
assert.match(agent.type, /^custom-import-/);
assert.equal(agent.phase, 'post_processing');
assert.equal(agent.resultType, 'context_injection');
assert.equal(agent.settings.resultType, 'context_injection');
assert.equal(agent.settings.injectAsSection, false);
assert.equal(agent.settings.includePreGenInjections, false);
assert.equal(agent.settings.includeParallelResults, false);
assert.equal(agent.connectionId, null);
assert.equal(agent.imagePath, null);
console.log('PASS name, new custom identity, Post-Processing, Context Injection, prompt section OFF');
assert.deepEqual(Object.keys(agent.settings.customCapabilities).sort(), [...api.CUSTOM_AGENT_CAPABILITY_IDS].sort());
for (const id of api.CUSTOM_AGENT_CAPABILITY_IDS) assert.equal(agent.settings.customCapabilities[id], false, id);
assert.deepEqual(requestedCapabilities, []);
assert.deepEqual(api.normalizeCustomAgentCapabilities(agent.settings), {});
assert.equal(agent.settings.enabledTools, undefined);
assert.equal(api.normalizeCustomAgentContextSources(agent.settings).chatHistory, true);
assert.equal(api.normalizeCustomAgentContextSources(agent.settings).characters, true);
console.log(`PASS all ${api.CUSTOM_AGENT_CAPABILITY_IDS.length} abilities OFF, zero requested permissions, zero tools`);
const prompt = readFileSync(join(here, '../agent-prompt.txt'), 'utf8');
assert.equal(agent.promptTemplate, prompt);
assert.ok(prompt.includes('PIXAI_PROMPT:'));
assert.ok(prompt.includes('PIXAI_NEGATIVE:'));
assert.ok(prompt.includes('PIXAI_RATIO:'));
assert.ok(prompt.includes('SKIP'));
console.log('PASS original agent-prompt.txt preserved byte-for-byte as UTF-8 prompt');
assert.equal(api.normalizeAgentImportEntry({ name: 'missing type' }), null);
assert.equal(api.importAgentConfigSchema.safeParse({ agent, source: 'file', approvedCapabilities: [], acknowledgePermissions: false }).success, false);
assert.equal(api.createAgentConfigSchema.safeParse({ ...agent, phase: 'Post-Processing' }).success, false);
assert.equal(api.createAgentConfigSchema.safeParse({ ...agent, resultType: 'Context Injection' }).success, false);
const stripped = api.sanitizeAgentSettingsForImport({ enabledTools: ['save_lorebook_entry'], spotifyAccessToken: 'test-sentinel' });
assert.equal(stripped.enabledTools, undefined);
assert.equal(stripped.spotifyAccessToken, undefined);
console.log('PASS negative cases: missing type, unacknowledged import, UI-label enums, unsafe settings');
console.log(`SHA256 ${createHash('sha256').update(bytes).digest('hex')}  pixai-director.agent.json`);
console.log('OFFLINE VALIDATION PASSED (no server, browser, installation, or PixAI requests)');
