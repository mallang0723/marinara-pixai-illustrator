const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
test('automatic restore does not enter or release another operation busy lock', async () => {
  let requests = 0;
  const ctx = vm.createContext({ busy: true, settings: { enabled: true }, apiKey: 'fixture-only', stopped: false,
    stopRevision: 0, boundAgentId: null, recordStage() {}, renderStatus() {},
    mfetch: async () => { requests++; return { ok: true, json: async () => [{ id: 'director', name: 'PixAI Director', type: 'custom-fixture' }] }; } });
  const start = source.indexOf('async function restoreAutomaticProcessing()');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), ctx);
  await ctx.restoreAutomaticProcessing();
  assert.equal(requests, 0);
  assert.equal(ctx.busy, true);
  assert.equal(ctx.boundAgentId, null);
});
