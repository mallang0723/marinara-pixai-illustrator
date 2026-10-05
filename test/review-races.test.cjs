const { test } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./v2-helpers.cjs');

function gate() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise(r => setImmediate(r));
const receipt = (overrides = {}) => ({
  operationId: 'old', source: 'selfie', anchor: { chatId: 'chat', characterId: 'char' },
  state: 'ambiguous', createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z', ...overrides,
});

// Independent tab queues, one Web Lock, and Engine's actual whole-document PATCH RMW.
for (const position of [{ button: { x: 30, y: 40 } }, null]) {
  test(`position ${position ? 'save' : 'reset'} cannot overwrite concurrent stop and receipts`, async () => {
    let stored = { schemaVersion: 2, enabled: true, stopEpoch: 0, operationLedger: [] };
    let tail = Promise.resolve(), reads = 0;
    const read = gate(), release = gate();
    const navigator = { locks: { request(name, _options, fn) {
      assert.equal(name, 'pixai-illustrator-storage');
      const work = tail.then(fn); tail = work.catch(() => {}); return work;
    } } };
    const storage = {
      get: async () => structuredClone(stored),
      patch: async patch => {
        const snapshot = structuredClone(stored); // Server reads before it merges/writes.
        reads++;
        if (Object.hasOwn(patch, 'uiPosition')) { read.resolve(); await release.promise; }
        stored = { ...snapshot, ...structuredClone(patch) };
      },
    };
    const values = { navigator, marinara: { storage }, settings: structuredClone(stored), saveQueue: Promise.resolve(),
      stopped: false, stopRevision: 0, isLeader: true, ensureRunning() {}, renderLedger() {}, MAX_REMEMBERED_RUNS: 500 };
    const a = context(['storageLock', 'savePosition'], values);
    const b = context(['storageLock', 'saveSettings', 'writeReceipt', 'isUnresolved', 'validateStorage'],
      { ...values, settings: structuredClone(stored), saveQueue: Promise.resolve() });
    const move = a.savePosition(position);
    await read.promise;
    const stop = b.saveSettings({ enabled: false, selfieInterceptEnabled: false });
    const ledger = b.writeReceipt({ operationId: 'work', source: 'selfie', anchor: { chatId: 'chat', characterId: 'char' } }, 'creating');
    await tick();
    const overlappingReads = reads;
    release.resolve();
    await Promise.all([move, stop, ledger]);
    assert.equal(stored.enabled, false, 'position must not restore ON');
    assert.equal(stored.stopEpoch, 1, 'position must not roll back stop epoch');
    assert.equal(stored.operationLedger[0]?.operationId, 'work', 'position must not erase receipt');
    assert.equal(overlappingReads, 1, 'server RMW reads must be serialized');
    assert.deepEqual(stored.uiPosition, position);
  });
}

function pipeline() {
  const stored = { schemaVersion: 2, enabled: true, stopEpoch: 0, operationLedger: [], modelVersionId: '123', loras: [], selfieInterceptEnabled: true };
  const calls = [];
  const c = context(['coordinate', 'executeOperation', 'writeReceipt', 'assertOperation', 'isUnresolved', 'validateStorage', 'migrateSettings',
    'pixaiCreateTask', 'parseLoras', 'truncatePrompt', 'installSelfieAdapter', 'matchSelfie', 'abortCaller',
    'handleSelfie', 'promptSignature', 'stopLocalWork', 'emergencyStop', 'saveSettings'], {
    settings: structuredClone(stored), apiKey: 'synthetic', isLeader: true, stopped: false, storageError: '', stopRevision: 0,
    saveQueue: Promise.resolve(), operationQueue: Promise.resolve(), inflight: new Map(), operationChats: new Map(), selfiePreviews: new Map(),
    storageLock: async fn => fn(), marinara: { storage: { get: async () => structuredClone(stored), patch: async p => Object.assign(stored, structuredClone(p)) } },
    requestControllers: new Set(), pendingDelays: new Map(), stopChannel: null, q: () => ({}), renderStatus() {}, ensureRunning() {}, MAX_REMEMBERED_RUNS: 500,
    location: { origin: 'https://fixture.test', href: 'https://fixture.test/' }, confirm: () => true,
    PIXAI_BASE: 'https://fixture.invalid', ASPECT_RATIOS: ['1:1'], DEFAULTS: { aspectRatio: '1:1' }, MAX_PROMPT_CHARS: 2000,
    ensureTaskAccess: async () => 404, pixaiHeaders: () => ({}), preparePrompt: async () => ({ prompt: 'scene', negative: '', loras: [] }),
    checkedFetch: async (url, init) => { calls.push({ url, init }); return Response.json({ id: 'task' }); },
    pixaiWaitTask: async () => ({}), pixaiDownload: async () => ({}), uploadToGallery: async () => ({ id: 'gallery' }),
    recordStage() {}, renderLedger() {}, describeFetchError: () => 'synthetic', showPreview() {},
  });
  c.window = c;
  c.fetch = async () => { calls.push({ native: true }); return Response.json({ original: true }); };
  const spec = { operationId: 'new', source: 'selfie', anchor: { chatId: 'chat', characterId: 'char' }, prepare: c.preparePrompt };
  return { c, stored, calls, spec };
}

for (const change of ['stop', 'key', 'leadership', 'abort', 'cleanup']) {
  test(`${change} during final storage read prevents actual create POST`, async () => {
    const { c, stored, calls, spec } = pipeline();
    const read = gate(), release = gate(), ctl = new AbortController();
    let reads = 0;
    c.marinara.storage.get = async () => {
      const snapshot = structuredClone(stored);
      // assertOperation reads: initial, prepared, claimed, creating, final POST guard.
      if (++reads === 7) { read.resolve(); await release.promise; }
      return snapshot;
    };
    const pending = c.coordinate({ ...spec, signal: ctl.signal });
    await read.promise;
    if (change === 'stop') await c.emergencyStop();
    if (change === 'key') c.apiKey = '';
    if (change === 'leadership') c.isLeader = false;
    if (change === 'abort') ctl.abort();
    if (change === 'cleanup') c.stopped = true;
    release.resolve();
    const result = await Promise.allSettled([pending]);
    assert.equal(calls.length, 0, 'no POST after state changed while storage was pending');
    assert.equal(result[0].status, 'rejected');
    assert.equal(stored.operationLedger[0].state, 'failedBeforeCreate');
  });
}

test('stop in the final guard continuation is checked synchronously at dispatch', async () => {
  const { c, calls, spec } = pipeline();
  const original = c.assertOperation;
  c.assertOperation = async operation => {
    const check = await original(operation);
    if (operation.creating) queueMicrotask(() => c.stopLocalWork());
    return check;
  };
  const result = await Promise.allSettled([c.coordinate(spec)]);
  assert.equal(calls.length, 0);
  assert.equal(result[0].status, 'rejected');
});

for (const change of ['stop', 'stop then re-enable', 'disable', 'cleanup']) {
  test(`${change} during Request body parsing cannot take over or forward to native generation`, async () => {
    const { c, calls } = pipeline();
    const read = gate(), release = gate();
    const request = new Request('https://fixture.test/api/gallery/chat/selfie', { method: 'POST', body: '{"characterId":"char"}' });
    const clone = request.clone.bind(request);
    request.clone = () => {
      const copy = clone(), text = copy.text.bind(copy);
      copy.text = async () => { read.resolve(); await release.promise; return text(); };
      return copy;
    };
    const cleanup = c.installSelfieAdapter();
    const pending = c.fetch(request);
    await read.promise;
    if (change.startsWith('stop')) await c.emergencyStop();
    if (change === 'stop then re-enable') c.settings.selfieInterceptEnabled = true;
    if (change === 'disable') c.settings.selfieInterceptEnabled = false;
    if (change === 'cleanup') cleanup();
    release.resolve();
    const result = await Promise.allSettled([pending]);
    assert.equal(calls.length, 0, 'neither Bridge POST nor native fallback is permitted');
    assert.equal(result[0].status, 'rejected');
    assert.equal(result[0].reason.name, 'AbortError');
    assert.equal(request.bodyUsed, false);
  });
}

const malformed = [
  { anchor: {} }, { anchor: [] }, { anchor: 'chat' }, { anchor: { chatId: 'chat' } },
  { anchor: { chatId: 7, characterId: 'char' } }, { anchor: { chatId: ' ', characterId: 'char' } },
  { anchor: { chatId: 'chat', characterId: '' } }, { source: 'unknown' }, { source: 1 },
  { operationId: '' }, { operationId: ' ' }, { operationId: 1 }, { state: 1 },
  { taskId: {} }, { taskId: '' }, { galleryId: 1 }, { createdAt: 5 }, { updatedAt: 'invalid' },
  { source: 'illustration', anchor: { chatId: 'chat', messageId: 'msg' } },
  { source: 'illustration', anchor: { chatId: 'chat', messageId: '', swipeIndex: 0 } },
  { source: 'illustration', anchor: { chatId: 'chat', messageId: 'msg', swipeIndex: -1 } },
  { source: 'illustration', anchor: { chatId: 'chat', messageId: 'msg', swipeIndex: '0' } },
  { source: 'diagnostic', anchor: { chatId: 'chat' } }, { state: 'taskKnown' },
  { state: 'uploaded', taskId: 'task' }, { state: 'attached', taskId: 'task', galleryId: 'gallery' },
];
test('malformed source-specific receipts fail closed at migration and paid boundaries', async () => {
  for (const bad of malformed) {
    const { c, stored, calls, spec } = pipeline();
    stored.operationLedger = [receipt(bad)];
    assert.throws(() => c.validateStorage(stored), /기록/, JSON.stringify(bad));
    await assert.rejects(c.migrateSettings(), /기록/);
    const result = await Promise.allSettled([c.coordinate(spec)]);
    assert.equal(result[0].status, 'rejected', JSON.stringify(bad));
    assert.equal(calls.length, 0);
    assert.equal(stored.operationLedger.length, 1, 'malformed ledger must not be overwritten');
  }
});
test('fresh malformed ledger appearing at the claim boundary cannot be overwritten or billed', async () => {
  const { c, stored, calls, spec } = pipeline();
  c.ensureTaskAccess = async () => { stored.operationLedger = [receipt({ anchor: {} })]; return 404; };
  const result = await Promise.allSettled([c.coordinate(spec)]);
  assert.equal(calls.length, 0);
  assert.equal(result[0].status, 'rejected');
  assert.deepEqual(stored.operationLedger, [receipt({ anchor: {} })]);
});

// Positive coverage for the stricter stored-receipt contract (additional GREEN checks).
test('valid illustration and diagnostic receipt lifecycles still complete', async () => {
  for (const source of ['illustration', 'diagnostic']) {
    const { c, stored, calls, spec } = pipeline();
    c.attachToMessage = async () => {};
    await c.coordinate({ ...spec, source, anchor: source === 'diagnostic' ? {} : { chatId: 'chat', messageId: 'msg', swipeIndex: 0 } });
    assert.equal(calls.length, 1);
    assert.equal(stored.operationLedger[0].state, source === 'diagnostic' ? 'complete' : 'attached');
    c.validateStorage(stored);
  }
});
