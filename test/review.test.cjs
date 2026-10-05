const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
const ratios = ['1:1','2:3','3:2','3:4','4:3','3:5','5:3','9:16','16:9'];
function clickHandler(selector, next, ctx) {
  let handler;
  const oldQ = ctx.q;
  ctx.q = s => s === selector ? { addEventListener: (event, fn) => { handler = fn; } } : oldQ(s);
  const start = source.indexOf(`q("${selector}").addEventListener`);
  vm.runInContext(source.slice(start, source.indexOf(next, start)), ctx);
  ctx.q = oldQ;
  return handler;
}
test('failed panel save leaves key/session untouched and releases busy', async () => {
  let sessionWrites = 0;
  const ctx = vm.createContext({ stopped: false, busy: false, apiKey: 'fixture-before', settings: { enabled: false },
    MAX_PROMPT_CHARS: 2000, SESSION_KEY_NAME: 'fixture-session',
    q: s => ({ value: s === '.pb-model' ? '123' : 'fixture-after', checked: s === '.pb-remember', children: [] }),
    parseLoras: () => [], saveSettings: async () => { throw new Error('fixture'); }, recordStage() {}, renderStatus() {},
    sessionStorage: { setItem: () => { sessionWrites++; }, removeItem: () => { sessionWrites++; } } });
  vm.runInContext(helper('truncatePrompt'), ctx);
  const click = clickHandler('.pb-save', 'q(".pb-delete-key")', ctx);
  await click();
  assert.equal(ctx.apiKey, 'fixture-before');
  assert.equal(sessionWrites, 0);
  assert.equal(ctx.busy, false);
});
test('reset stops immediately while busy even if persistence fails', async () => {
  let writes = 0;
  const ctx = vm.createContext({ stopRevision: 0, stopped: false, busy: true, settings: { enabled: true }, armedAt: 1,
    q: () => ({}), saveSettings: async () => { writes++; throw new Error('fixture'); }, recordStage() {}, renderStatus() {} });
  const click = clickHandler('.pb-clear', '\nfunction renderStatus()', ctx);
  const pending = click();
  assert.equal(ctx.settings.enabled, false);
  assert.equal(ctx.busy, true);
  await pending;
  assert.equal(writes, 1);
  assert.equal(ctx.settings.enabled, false);
  assert.equal(ctx.busy, true);
});
test('reset during run-id persistence prevents unstarted candidates despite queued stop failure', async () => {
  let release; let writes = 0; let creates = 0;
  const run = { chatId: 'chat', agentConfigId: 'bound', createdAt: '2026-10-02T02:01:00Z', resultType: 'context_injection', resultData: { text: 'PIXAI_PROMPT: fixture' } };
  const ctx = vm.createContext({ stopRevision: 0, stopped: false, busy: false, isLeader: true, apiKey: 'fixture', boundAgentId: 'bound', armedAt: 0,
    settings: { enabled: true, processedRunIds: [] }, saveQueue: Promise.resolve(), MAX_REMEMBERED_RUNS: 500, sessionSeen: new Set(),
    q: () => ({}), recordStage() {}, renderStatus() {}, ensureRunning() {}, describeFetchError: () => 'fixture', activeChatId: () => 'chat',
    mfetch: async () => ({ ok: true, json: async () => Array.from({ length: 5 }, (_, id) => ({ ...run, id: String(id) })) }),
    processRun: async () => { creates++; },
    marinara: { storage: { patch: async () => { if (++writes === 1) await new Promise(r => { release = r; }); else throw new Error('stop persistence failed'); } } } });
  vm.runInContext(helper('saveSettings') + '\n' + helper('pollOnce'), ctx);
  const click = clickHandler('.pb-clear', '\nfunction renderStatus()', ctx);
  const poll = ctx.pollOnce();
  await new Promise(r => setImmediate(r));
  const reset = click();
  const immediate = ctx.settings.enabled;
  release();
  await Promise.all([poll, reset]);
  assert.equal(immediate, false);
  assert.equal(creates, 0);
  assert.equal(ctx.settings.enabled, false);
});
test('reset lets the active run finish but prevents the remaining four candidates', async () => {
  let release; let creates = 0; let completed = 0;
  const run = { chatId: 'chat', agentConfigId: 'bound', createdAt: '2026-10-02T02:01:00Z', resultType: 'context_injection', resultData: { text: 'PIXAI_PROMPT: fixture' } };
  const ctx = vm.createContext({ stopRevision: 0, stopped: false, busy: false, isLeader: true, apiKey: 'fixture', boundAgentId: 'bound', armedAt: 0,
    settings: { enabled: true, processedRunIds: [] }, saveQueue: Promise.resolve(), MAX_REMEMBERED_RUNS: 500, sessionSeen: new Set(),
    q: () => ({}), recordStage() {}, renderStatus() {}, ensureRunning() {}, describeFetchError: () => 'fixture', activeChatId: () => 'chat',
    mfetch: async () => ({ ok: true, json: async () => Array.from({ length: 5 }, (_, id) => ({ ...run, id: String(id) })) }),
    processRun: async () => { creates++; await new Promise(r => { release = r; }); completed++; },
    marinara: { storage: { patch: async () => {} } } });
  vm.runInContext(helper('saveSettings') + '\n' + helper('pollOnce'), ctx);
  const click = clickHandler('.pb-clear', '\nfunction renderStatus()', ctx);
  const poll = ctx.pollOnce();
  await new Promise(r => setImmediate(r));
  await click();
  assert.equal(ctx.busy, true);
  assert.equal(ctx.settings.enabled, false);
  release(); await poll;
  assert.equal(creates, 1);
  assert.equal(completed, 1);
  assert.equal(ctx.busy, false);
});
test('panel negative default truncates at a code-point boundary', async () => {
  let saved;
  const ctx = vm.createContext({ stopped: false, busy: false, apiKey: '', settings: { enabled: false },
    MAX_PROMPT_CHARS: 2000, SESSION_KEY_NAME: 'fixture-session',
    q: s => ({ value: s === '.pb-model' ? '123' : 'a'.repeat(1999) + '😀', checked: false, children: [] }),
    parseLoras: () => [], saveSettings: async patch => { saved = patch; }, recordStage() {}, renderStatus() {},
    sessionStorage: { removeItem() {} } });
  vm.runInContext(helper('truncatePrompt'), ctx);
  await clickHandler('.pb-save', 'q(".pb-delete-key")', ctx)();
  assert.equal(saved.negativeDefault, 'a'.repeat(1999));
});
test('attachment filename follows actual blob MIME while preserving existing attachments', async () => {
  let body;
  const ctx = vm.createContext({ CSS: { escape: x => x }, document: { querySelector: () => null }, recordStage() {},
    mfetch: async (url, init) => { if (init) { body = JSON.parse(init.body); return { ok: true }; }
      return { ok: true, json: async () => [{ id: 'msg', extra: { attachments: [{ id: 'existing' }] } }] }; } });
  vm.runInContext(helper('extFromBlob') + '\n' + helper('attachToMessage'), ctx);
  for (const [type, ext] of [['image/jpeg','jpg'], ['image/webp','webp'], ['image/png','png']]) {
    await ctx.attachToMessage('chat','msg',{ id: 'image', url: '/api/gallery/file/chat/image' },'fixture', { type });
    assert.equal(body.attachments[1].filename, `pixai.${ext}`);
    assert.equal(body.attachments[0].id, 'existing');
  }
});
test('create boundary also bounds default negative and normalizes invalid ratio', async () => {
  let body;
  const ctx = vm.createContext({ settings: { modelVersionId: '123', loras: [], aspectRatio: '3:4', negativeDefault: 'n'.repeat(2100) },
    ASPECT_RATIOS: ratios, DEFAULTS: { aspectRatio: '2:3' }, MAX_PROMPT_CHARS: 2000, PIXAI_BASE: 'https://api.pixai.art', ensureTaskAccess: async () => 404,
    pixaiHeaders: () => ({}), recordStage() {}, checkedFetch: async (url, init) => { body = JSON.parse(init.body); return { ok: true, text: async () => '{}' }; } });
  vm.runInContext(helper('truncatePrompt') + '\n' + helper('parseLoras') + '\n' + helper('pixaiCreateTask'), ctx);
  await ctx.pixaiCreateTask('p'.repeat(2100), '', 'bad');
  assert.equal(body.prompt.length, 2000);
  assert.equal(body.negativePrompt.length, 2000);
  assert.equal(body.aspectRatio, '3:4');
  for (const prefix of [1998, 1999, 2000]) {
    const input = 'a'.repeat(prefix) + '😀tail';
    ctx.settings.negativeDefault = input;
    await ctx.pixaiCreateTask(input, '', '1:1');
    for (const value of [body.prompt, body.negativePrompt]) {
      assert.ok(value.length <= 2000);
      assert.ok(value.isWellFormed(), `split surrogate at ${prefix}`);
      assert.equal(value, 'a'.repeat(prefix) + (prefix === 1998 ? '😀' : ''));
    }
  }
});
test('settings writes serialize and merge against latest committed state', async () => {
  const writes = []; let release;
  const ctx = vm.createContext({ stopRevision: 0, settings: { enabled: true, processedRunIds: [] }, saveQueue: Promise.resolve(), MAX_REMEMBERED_RUNS: 500,
    ensureRunning() {}, marinara: { storage: { patch: async value => { writes.push(value); if (writes.length === 1) await new Promise(r => { release = r; }); } } } });
  vm.runInContext(helper('saveSettings'), ctx);
  const a = ctx.saveSettings({ processedRunIds: ['new-run'] });
  const b = ctx.saveSettings({ enabled: false });
  await new Promise(r => setImmediate(r));
  assert.equal(writes.length, 1);
  release(); await Promise.all([a, b]);
  assert.equal(ctx.settings.enabled, false);
  assert.deepEqual([...ctx.settings.processedRunIds], ['new-run']);
  assert.deepEqual([...writes[1].processedRunIds], ['new-run']);
  ctx.marinara.storage.patch = async () => { throw new Error('fixture'); };
  await assert.rejects(ctx.saveSettings({ enabled: true }));
  ctx.marinara.storage.patch = async () => {};
  await ctx.saveSettings({ size: '1k' });
  assert.equal(ctx.settings.enabled, false);
});
test('background settings writes do not resend a stale remembered key', async () => {
  let written;
  const ctx = vm.createContext({ stopRevision: 0, settings: { apiKey: 'fixture-stale', rememberKey: true, processedRunIds: [] },
    saveQueue: Promise.resolve(), MAX_REMEMBERED_RUNS: 500, ensureRunning() {},
    marinara: { storage: { patch: async value => { written = value; } } } });
  vm.runInContext(helper('saveSettings'), ctx);
  await ctx.saveSettings({ processedRunIds: ['run'] });
  assert.equal(Object.hasOwn(written, 'apiKey'), false);
  assert.equal(Object.hasOwn(written, 'rememberKey'), false);
});
function helper(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
test('agent ratio uses panel allowlist and prompt fields are bounded', () => {
  const ctx = vm.createContext({ settings: { aspectRatio: '3:4' }, DEFAULTS: { aspectRatio: '2:3' }, ASPECT_RATIOS: ratios, MAX_PROMPT_CHARS: 2000 });
  vm.runInContext(helper('truncatePrompt') + '\n' + helper('parseAgentText'), ctx);
  for (const ratio of ratios) assert.equal(ctx.parseAgentText(`PIXAI_PROMPT: scene\nPIXAI_RATIO: ${ratio}`).ratio, ratio);
  for (const ratio of ['bogus', '<img>', '', '1:2']) assert.equal(ctx.parseAgentText(`PIXAI_PROMPT: scene\nPIXAI_RATIO: ${ratio}`).ratio, '3:4');
  const result = ctx.parseAgentText(`PIXAI_PROMPT: ${'a'.repeat(2100)}\nPIXAI_NEGATIVE: ${'b'.repeat(2100)}`);
  assert.equal(result.prompt.length, 2000);
  assert.equal(result.negative.length, 2000);
  const unicode = 'x'.repeat(1999) + '😀';
  const parsed = ctx.parseAgentText(`PIXAI_PROMPT: ${unicode}\nPIXAI_NEGATIVE: ${unicode}`);
  assert.equal(parsed.prompt, 'x'.repeat(1999));
  assert.equal(parsed.negative, 'x'.repeat(1999));
  ctx.settings.aspectRatio = 'bad';
  assert.equal(ctx.parseAgentText('PIXAI_PROMPT: scene').ratio, '2:3');
  assert.equal(ctx.parseAgentText('SKIP'), null);
  assert.equal(ctx.parseAgentText({}), null);
});
