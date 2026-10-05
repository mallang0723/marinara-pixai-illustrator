const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
function helper(name) {
  const start = source.search(new RegExp(`function ${name}\\(`));
  assert.notEqual(start, -1, `missing ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
test('positions clamp to visible viewport including offsets and invalid saved coordinates', () => {
  const ctx = vm.createContext({});
  vm.runInContext(helper('clampPosition'), ctx);
  const viewport = { x: 0, y: 0, width: 390, height: 844 };
  const size = { width: 36, height: 36 };
  const clamp = (p, s = size, v = viewport) => JSON.parse(JSON.stringify(ctx.clampPosition(p, s, v)));
  assert.deepEqual(clamp({ x: -100, y: 2000 }), { x: 8, y: 800 });
  assert.deepEqual(clamp({ x: 100, y: 200 }), { x: 100, y: 200 });
  assert.deepEqual(clamp({ x: Infinity, y: 'bad' }), { x: 8, y: 8 });
  assert.deepEqual(clamp(null), { x: 8, y: 8 });
  assert.deepEqual(clamp({ x: 0, y: 999 }, size, { x: 20, y: 50, width: 200, height: 300 }), { x: 28, y: 306 });
  assert.deepEqual(clamp({ x: 100, y: 100 }, { width: 500, height: 1000 }), { x: 8, y: 8 });
});
test('stale tab position saves and reset preserve another tab OFF, model and processed runs', async () => {
  const stored = { enabled: false, modelVersionId: 'new-model', processedRunIds: ['new-run'] };
  const writes = [];
  const ctx = vm.createContext({
    settings: { enabled: true, modelVersionId: 'old-model', processedRunIds: [] },
    saveQueue: Promise.resolve(), stopRevision: 0, MAX_REMEMBERED_RUNS: 500,
    stopped: false, ensureRunning() {}, recordStage() {},
    marinara: { storage: { patch: async p => { writes.push(JSON.parse(JSON.stringify(p))); Object.assign(stored, p); } } },
  });
  vm.runInContext(helper('saveSettings'), ctx);
  if (source.includes('function savePosition(')) vm.runInContext(helper('savePosition'), ctx);
  const persist = source.match(/const persist = \(value\) => \{[\s\S]*?\n  \};/)[0];
  vm.runInContext(persist + '\nglobalThis.persist = persist;', ctx);
  for (const value of [{ button: { x: 30, y: 40 } }, null]) {
    ctx.persist(value);
    await ctx.saveQueue;
    assert.equal(stored.enabled, false, 'tab A OFF must survive stale tab B position write');
    assert.equal(stored.modelVersionId, 'new-model');
    assert.deepEqual(stored.processedRunIds, ['new-run']);
    assert.deepEqual(writes.at(-1), { uiPosition: value }, 'only the position key may be patched');
    assert.deepEqual(ctx.settings.uiPosition, value);
  }
});
