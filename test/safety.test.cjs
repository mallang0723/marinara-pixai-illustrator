const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
test('failed settings persistence cannot arm automatic billing', async () => {
  const ctx = vm.createContext({ stopRevision: 0, settings: { enabled: false, processedRunIds: [] }, MAX_REMEMBERED_RUNS: 500, saveQueue: Promise.resolve(),
    ensureRunning() {}, marinara: { storage: { patch: async () => { throw new Error('fixture storage failure'); } } } });
  vm.runInContext(helper('saveSettings'), ctx);
  await assert.rejects(ctx.saveSettings({ enabled: true }));
  assert.equal(ctx.settings.enabled, false);
});
test('poll only processes newly armed matching agent runs once; follower tab is inert', async () => {
  const done = [];
  const run = { id: 'fresh', chatId: 'chat', agentConfigId: 'bound', createdAt: '2026-10-02T02:01:00Z', resultType: 'context_injection', resultData: { text: 'PIXAI_PROMPT: fixture' } };
  const ctx = vm.createContext({ stopped: false, isLeader: true, busy: false, apiKey: 'fixture-only', boundAgentId: 'bound',
    armedAt: Date.parse('2026-10-02T02:00:00Z'), settings: { enabled: true, processedRunIds: [] }, sessionSeen: new Set(),
    activeChatId: () => 'chat', recordStage() {}, describeFetchError: () => 'fixture',
    mfetch: async () => ({ ok: true, json: async () => [run, { ...run, id: 'old', createdAt: '2026-10-02T01:00:00Z' }, { ...run, id: 'other', agentConfigId: 'other' }] }),
    saveSettings: async patch => { Object.assign(ctx.settings, patch); }, processRun: async r => { done.push(r.id); },
  });
  vm.runInContext(helper('pollOnce'), ctx);
  await ctx.pollOnce(); await ctx.pollOnce();
  assert.deepEqual(done, ['fresh']);
  ctx.settings.processedRunIds = []; // retained session set still prevents eviction replay
  await ctx.pollOnce();
  assert.deepEqual(done, ['fresh']);
  ctx.isLeader = false;
  ctx.mfetch = async () => { throw new Error('follower must not poll'); };
  await ctx.pollOnce();
});
test('paid diagnostics lock excludes double click and cleanup blocks the next step', async () => {
  let resume, creates = 0, downloads = 0;
  const ctx = vm.createContext({ stopped: false, busy: false, isLeader: true, apiKey: 'fixture-only', PIXAI_BASE: 'https://api.pixai.art',
    confirm: () => true, recordStage() {}, pixaiHeaders: () => ({}), describeFetchError: () => 'fixture',
    ensureTaskAccess: async () => 404,
    pixaiCreateTask: async () => { creates++; await new Promise(r => { resume = r; }); return { id: 'fixture' }; },
    pixaiWaitTask: async () => { if (ctx.stopped) throw new Error('stopped'); return {}; },
    pixaiDownload: async () => { downloads++; },
  });
  vm.runInContext(helper('runDiagnostics'), ctx);
  const first = ctx.runDiagnostics(true);
  await new Promise(r => setImmediate(r));
  await ctx.runDiagnostics(true);
  assert.equal(creates, 1);
  ctx.stopped = true; resume(); await first;
  assert.equal(downloads, 0);
  assert.equal(ctx.busy, false);
});
function helper(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `missing ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
test('attachment read failure is fail-closed, never PATCH', async () => {
  let requests = 0;
  const ctx = vm.createContext({ ensureRunning() {}, safeJson: JSON.parse, recordStage() {},
    mfetch: async () => { requests++; return { ok: false, status: 500 }; } });
  vm.runInContext(helper('attachToMessage'), ctx);
  await assert.rejects(ctx.attachToMessage('chat', 'message', { id: 'img', url: '/api/gallery/file/chat/img.png' }, 'fixture'));
  assert.equal(requests, 1);
});
test('requests after cleanup are rejected before I/O', async () => {
  let calls = 0;
  const ctx = vm.createContext({ stopped: true, DOMException, AbortController, AbortSignal,
    requestControllers: new Set(), marinara: { fetch: async () => { calls++; } } });
  vm.runInContext(helper('ensureRunning') + '\n' + helper('checkedFetch'), ctx);
  await assert.rejects(ctx.checkedFetch('/api/fixture'));
  assert.equal(calls, 0);
});
test('untrusted media URLs cannot cause any browser fetch', async () => {
  for (const url of ['http://127.0.0.1/private', 'https://evil.test/a', 'https://d2doj8oszwtcqy.cloudfront.net.evil.test/a', 'data:image/png;base64,AAAA']) {
    let calls = 0;
    const ctx = vm.createContext({ URL, PIXAI_BASE: 'https://api.pixai.art', recordStage() {}, describeFetchError: () => 'fixture',
      checkedFetch: async () => { calls++; throw new Error('unexpected network'); },
      marinara: { fetch: async () => { calls++; throw new Error('unexpected network'); } },
      pixaiHeaders: () => ({}), MAX_IMAGE_BYTES: 20 * 1024 * 1024 });
    if (source.includes('function safeMediaUrl(')) vm.runInContext(helper('safeMediaUrl'), ctx);
    vm.runInContext(helper('pixaiDownload'), ctx);
    await assert.rejects(ctx.pixaiDownload({ outputs: { mediaUrls: [url] } }));
    assert.equal(calls, 0, url);
  }
});
