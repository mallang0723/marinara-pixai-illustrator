const { test } = require('node:test');
const assert = require('node:assert/strict');
const { context } = require('./v2-helpers.cjs');

function fixture() {
  const stored = { schemaVersion: 2, stopEpoch: 0, operationLedger: [], enabled: true,
    selfieInterceptEnabled: true, selfieUseRecentContext: true, personaAppearanceEnabled: true,
    modelVersionId: '123', loras: [] };
  let finishPoll, posts = 0, uploads = 0;
  const c = context(['saveSettings', 'coordinate', 'executeOperation', 'writeReceipt',
    'assertOperation', 'isUnresolved', 'validateStorage', 'pixaiCreateTask', 'parseLoras', 'truncatePrompt'], {
    settings: structuredClone(stored), apiKey: 'synthetic', isLeader: true, stopped: false,
    storageError: '', stopRevision: 0, saveQueue: Promise.resolve(), operationQueue: Promise.resolve(),
    inflight: new Map(), operationChats: new Map(), MAX_REMEMBERED_RUNS: 500,
    MAX_PROMPT_CHARS: 2000, ASPECT_RATIOS: ['1:1'], DEFAULTS: { aspectRatio: '1:1' }, PIXAI_BASE: 'https://fixture.invalid',
    storageLock: async fn => fn(), ensureRunning() {}, ensureTaskAccess: async () => 404,
    pixaiHeaders: () => ({}), describeFetchError: () => '', recordStage() {}, renderLedger() {},
    marinara: { storage: { get: async () => structuredClone(stored), patch: async p => Object.assign(stored, structuredClone(p)) } },
    checkedFetch: async () => { posts++; return Response.json({ id: 'task' }); },
    pixaiWaitTask: async () => new Promise(resolve => { finishPoll = resolve; }),
    pixaiDownload: async () => ({}), uploadToGallery: async () => { uploads++; return { id: 'gallery' }; }, attachToMessage: async () => {},
  });
  const spec = { operationId: 'selfie-fixture', source: 'selfie', anchor: { chatId: 'chat', characterId: 'char' },
    prepare: async () => ({ prompt: 'scene', negative: '', loras: [] }) };
  return { c, stored, spec, finish: () => finishPoll({}), counts: () => ({ posts, uploads }) };
}

test('recent-context OFF during selfie poll keeps the paid task through gallery with unchanged stopEpoch', async () => {
  const f = fixture();
  const work = f.c.coordinate(f.spec);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counts().posts, 1);
  await f.c.saveSettings({ selfieUseRecentContext: false });
  f.finish();
  await work;
  assert.deepEqual(f.counts(), { posts: 1, uploads: 1 });
  assert.equal(f.stored.stopEpoch, 0);
  assert.equal(f.stored.selfieUseRecentContext, false);
  assert.equal(f.stored.operationLedger[0].state, 'complete');
});

test('persona OFF applies to the next snapshot and does not discard the paid task', async () => {
  const f = fixture();
  const snapshots = [];
  const prepare = async options => { snapshots.push(options.personaAppearanceEnabled); return { prompt: 'scene', negative: '', loras: [] }; };
  const first = f.c.coordinate({ ...f.spec, prepare });
  await new Promise(resolve => setImmediate(resolve));
  await f.c.saveSettings({ personaAppearanceEnabled: false });
  f.finish();
  await first;
  f.c.pixaiWaitTask = async () => ({});
  await f.c.coordinate({ ...f.spec, operationId: 'next', prepare });
  assert.deepEqual(snapshots, [true, false]);
  assert.deepEqual(f.counts(), { posts: 2, uploads: 2 });
  assert.equal(f.stored.stopEpoch, 0);
});

test('follower feature OFF lets paid work finish but blocks the next leader request', async () => {
  const f = fixture();
  const first = f.c.coordinate(f.spec);
  await new Promise(resolve => setImmediate(resolve));
  const follower = context(['saveSettings'], { settings: structuredClone(f.stored), isLeader: false,
    stopRevision: 0, saveQueue: Promise.resolve(), ensureRunning() {}, storageLock: async fn => fn(),
    marinara: f.c.marinara, MAX_REMEMBERED_RUNS: 500 });
  await follower.saveSettings({ selfieInterceptEnabled: false });
  f.finish();
  await first;
  await assert.rejects(f.c.coordinate({ ...f.spec, operationId: 'next' }), { name: 'AbortError' });
  assert.deepEqual(f.counts(), { posts: 1, uploads: 1 });
  assert.equal(f.stored.stopEpoch, 0);
});

test('follower privacy OFF is loaded for the next request without changing a paid snapshot', async () => {
  const f = fixture();
  const snapshots = [];
  const prepare = async options => { snapshots.push(options.selfieUseRecentContext); return { prompt: 'scene', negative: '', loras: [] }; };
  const first = f.c.coordinate({ ...f.spec, prepare });
  await new Promise(resolve => setImmediate(resolve));
  const follower = context(['saveSettings'], { settings: structuredClone(f.stored), isLeader: false,
    stopRevision: 0, saveQueue: Promise.resolve(), ensureRunning() {}, storageLock: async fn => fn(),
    marinara: f.c.marinara, MAX_REMEMBERED_RUNS: 500 });
  await follower.saveSettings({ selfieUseRecentContext: false });
  f.finish();
  await first;
  f.c.pixaiWaitTask = async () => ({});
  await f.c.coordinate({ ...f.spec, operationId: 'next', prepare });
  assert.deepEqual(snapshots, [true, false]);
  assert.deepEqual(f.counts(), { posts: 2, uploads: 2 });
  assert.equal(f.stored.stopEpoch, 0);
});

test('explicit emergency stop still interrupts paid work and persists the stopEpoch', async () => {
  const f = fixture();
  const work = f.c.coordinate(f.spec);
  await new Promise(resolve => setImmediate(resolve));
  await f.c.saveSettings({ enabled: false, selfieInterceptEnabled: false }, { emergency: true });
  f.finish();
  await assert.rejects(work, { name: 'AbortError' });
  assert.deepEqual(f.counts(), { posts: 1, uploads: 0 });
  assert.equal(f.stored.stopEpoch, 1);
  assert.equal(f.stored.operationLedger[0].state, 'taskKnown');
});

test('invalid model before create records failedBeforeCreate rather than ambiguous', async () => {
  const f = fixture();
  f.c.settings.modelVersionId = 'invalid';
  await assert.rejects(f.c.coordinate(f.spec), /모델 ID/);
  assert.equal(f.counts().posts, 0);
  assert.equal(f.stored.operationLedger[0].state, 'failedBeforeCreate');
});

test('feature OFF in final preflight prevents POST without marking acceptance ambiguous', async () => {
  const f = fixture();
  f.c.pixaiWaitTask = async () => ({});
  let probes = 0;
  f.c.ensureTaskAccess = async () => {
    if (++probes === 2) await f.c.saveSettings({ selfieInterceptEnabled: false });
    return 404;
  };
  await assert.rejects(f.c.coordinate(f.spec), { name: 'AbortError' });
  assert.equal(f.counts().posts, 0);
  assert.equal(f.stored.operationLedger[0].state, 'failedBeforeCreate');
});

for (const [source, key] of [['selfie', 'selfieInterceptEnabled'], ['illustration', 'enabled']]) {
  test(`${key} OFF before create blocks queued ${source} without raising stopEpoch`, async () => {
    const f = fixture();
    f.c.pixaiWaitTask = async () => ({});
    let release;
    f.c.operationQueue = new Promise(resolve => { release = resolve; });
    const spec = { ...f.spec, source, anchor: source === 'illustration'
      ? { chatId: 'chat', messageId: 'message', swipeIndex: 0 } : f.spec.anchor };
    const work = f.c.coordinate(spec);
    await f.c.saveSettings({ [key]: false });
    release();
    await assert.rejects(work, { name: 'AbortError' });
    assert.deepEqual(f.counts(), { posts: 0, uploads: 0 });
    assert.equal(f.stored.stopEpoch, 0);
  });

  test(`${key} OFF during poll preserves already paid ${source}`, async () => {
    const f = fixture();
    const work = f.c.coordinate({ ...f.spec, source, anchor: source === 'illustration'
      ? { chatId: 'chat', messageId: 'message', swipeIndex: 0 } : f.spec.anchor });
    await new Promise(resolve => setImmediate(resolve));
    await f.c.saveSettings({ [key]: false });
    f.finish();
    await work;
    assert.deepEqual(f.counts(), { posts: 1, uploads: 1 });
    assert.equal(f.stored.stopEpoch, 0);
  });
}
