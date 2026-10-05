// Offline helper tests only: no extension installation, DOM runtime or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
test('LoRA input survives settings and creates official modelId/weight payload without precision loss', async () => {
  const calls = [];
  const ctx = vm.createContext({
    settings: { modelVersionId: '1983308862240288769', loras: '1744880666293972790:0.7, 9999999999999999999:0', processedRunIds: [] },
    MAX_REMEMBERED_RUNS: 500, PIXAI_BASE: 'https://api.pixai.art', saveQueue: Promise.resolve(), stopRevision: 0,
    MAX_PROMPT_CHARS: 2000, ASPECT_RATIOS: ['1:1'], DEFAULTS: { aspectRatio: '2:3' },
    ensureRunning() {},
    checkedFetch: async (url, init) => {
      calls.push(JSON.parse(init.body)); return { ok: true, text: async () => '{"id":"fixture"}' };
    },
    pixaiHeaders: () => ({}), recordStage: () => {},
    marinara: { storage: { patch: async () => {} }, fetch: async (url, init) => {
      calls.push(JSON.parse(init.body)); return { ok: true, text: async () => '{"id":"fixture"}' };
    } },
  });
  vm.runInContext(helper('truncatePrompt') + '\n' + helper('parseLoras') + '\n' + helper('saveSettings') + '\n' + helper('pixaiCreateTask'), ctx);
  await ctx.saveSettings({ loras: ctx.settings.loras });
  await ctx.pixaiCreateTask('fixture', '', '1:1');
  assert.deepEqual(calls[0].loras, [{ modelId: '1744880666293972790', weight: 0.7 }, { modelId: '9999999999999999999', weight: 0 }]);
  for (const input of ['1:', '1:NaN', '1:Infinity', '1:-0.1', '1:1.1', '1:0.5,', '1:0.5,1:0.2', 'a:0.2', '1:0:2', '1:1,2:1,3:1,4:1,5:1,6:1']) {
    ctx.settings.loras = input;
    await assert.rejects(ctx.pixaiCreateTask('fixture', '', '1:1'), /LoRA/);
    assert.equal(calls.length, 1, 'invalid input must not create a paid task');
  }
  ctx.settings.loras = '   ';
  await ctx.pixaiCreateTask('fixture', '', '1:1');
  assert.equal('loras' in calls[1], false);
  ctx.settings.loras = [{ modelId: '1744880666293972790', weight: 1 }];
  await ctx.pixaiCreateTask('fixture', '', '1:1');
  assert.deepEqual(calls[2].loras, [{ modelId: '1744880666293972790', weight: 1 }]);
});
function helper(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `missing helper ${name}`);
  const next = source.indexOf('\n}', start);
  return source.slice(start, next + 2);
}
test('mfetch sends public CSRF marker only on unsafe methods, preserving multipart boundary', async () => {
  const calls = [];
  const ctx = vm.createContext({ Headers, CSRF_HEADER: 'x-marinara-csrf', checkedFetch: async (...args) => calls.push(args) });
  vm.runInContext(helper('mfetch'), ctx);
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    await ctx.mfetch('/fixture', { method, body: method === 'PATCH' ? '{}' : undefined });
    const [url, init] = calls.at(-1);
    assert.equal(url, '/api/fixture');
    assert.equal(init.headers.get('x-marinara-csrf'), ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? '1' : null);
    assert.equal(init.headers.get('content-type'), method === 'PATCH' ? 'application/json' : null);
    assert.equal(init.credentials, 'same-origin');
  }
});
