// Synthetic transports only. These exercise the actual extracted helpers and UI handlers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { context, source } = require('./v2-helpers.cjs');
const secret = 'PRIVATE-key-prompt-body-name-id-lora-<img src=x>';

function fixture(transport = async () => new Response(null, { status: 404 })) {
  const calls = [], stages = [];
  const c = context(['describeFetchError', 'parseLoras', 'truncatePrompt', 'pixaiHeaders',
    'ensureTaskAccess', 'pixaiCreateTask', 'pixaiWaitTask', 'runDiagnostics', 'saveSettings'], {
    TypeError, PIXAI_BASE: 'https://fixture.invalid', MAX_PROMPT_CHARS: 2000,
    ASPECT_RATIOS: ['1:1'], DEFAULTS: { aspectRatio: '1:1' },
    settings: { modelVersionId: '123', loras: [], enabled: false, rememberKey: true },
    apiKey: 'synthetic-key-a', taskAccessCheck: null, stopped: false, busy: false, isLeader: true,
    confirm: () => true, ensureRunning() {}, renderStatus() {},
    POLL_TASK_MS: 0, TASK_TIMEOUT_MS: 100, delay: async () => {}, MAX_REMEMBERED_RUNS: 500,
    recordStage: (...args) => stages.push(args),
    checkedFetch: async (...args) => { calls.push(args); return transport(...args); },
  });
  require('./coordinator-fixture.cjs')(c);
  return { c, calls, stages };
}

function saveButton(c) {
  const controls = new Map();
  const values = { '.pb-model': '123', '.pb-key': c.apiKey, '.pb-ratio': '1:1',
    '.pb-size': '1k', '.pb-mode': 'standard', '.pb-helper': 'disable', '.pb-neg': '' };
  let click;
  c.q = selector => {
    if (!controls.has(selector)) controls.set(selector, { value: values[selector] || '',
      checked: selector === '.pb-remember', children: [], addEventListener: (_event, fn) => { click = fn; } });
    return controls.get(selector);
  };
  const start = source.indexOf('q(".pb-save").addEventListener');
  vm.runInContext(source.slice(start, source.indexOf('q(".pb-delete-key")', start)), c);
  return click;
}

for (const status of [401, 403]) test(`both diagnostics log and display HTTP ${status} without response body`, async () => {
  for (const paid of [false, true]) {
    const f = fixture(async () => new Response(secret, { status, statusText: secret }));
    await f.c.runDiagnostics(paid);
    assert.equal(f.calls.length, 1);
    assert.ok(f.stages.some(([stage, ok, detail]) => stage === 'pixai.preflight GET' && !ok && detail.includes(`HTTP ${status}`)));
    assert.ok(f.stages.some(([stage, ok, detail]) => stage === 'diag' && !ok && detail.includes(`HTTP ${status}`)));
    assert.equal(JSON.stringify(f.stages).includes(secret), false);
    assert.equal(f.c.busy, false);
  }
});

test('own LoRA/model/storage/unresolved errors survive diagnostic and coordinator sinks', async () => {
  const cases = [
    [c => { c.settings.loras = `${secret}:2`; c.composePrompt = () => c.parseLoras(c.settings.loras); }, /LoRA ID/],
    [c => { c.settings.modelVersionId = secret; }, /모델 ID/],
    [c => { c.marinara.storage.get = async () => ({ schemaVersion: 99 }); }, /저장소 버전/],
    [c => { c.marinara.storage.get = async () => ({ schemaVersion: 2, operationLedger: [{
      operationId: secret, source: 'diagnostic', anchor: {}, state: 'ambiguous',
      createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z',
    }] }); }, /미해결 작업/],
  ];
  for (const [setup, expected] of cases) {
    const f = fixture(); setup(f.c);
    await f.c.runDiagnostics(true);
    for (const stage of ['diag', 'operation']) {
      assert.match(f.stages.findLast(row => row[0] === stage)[2], expected);
    }
    assert.equal(f.calls.some(([, init]) => init.method === 'POST'), false);
    assert.equal(JSON.stringify(f.stages).includes(secret), false);
  }
});

test('arbitrary errors, lookalike brands and JSON parser bodies stay redacted', async () => {
  const f = fixture();
  for (const error of [new Error(secret), new TypeError(secret), new SyntaxError(secret),
    { message: secret, name: 'BridgeError', trusted: true, safeMessage: secret }, secret, null]) {
    assert.equal(f.c.describeFetchError(error).includes(secret), false);
  }
  let own;
  try { f.c.parseLoras('invalid'); } catch (error) { own = error; }
  const expected = f.c.describeFetchError(own);
  assert.match(expected, /LoRA/);
  assert.doesNotMatch(f.c.describeFetchError(new Error(`HTTP 401 ${secret}`)), /HTTP 401/);
  assert.doesNotMatch(f.c.describeFetchError(Object.assign(new Error(secret), own)), /LoRA/);
  own.message = secret;
  assert.equal(f.c.describeFetchError(own), expected, 'trusted display text is an immutable snapshot');
  for (const error of [new Error(secret), new TypeError(secret), new SyntaxError(secret)]) {
    const g = fixture(async () => { throw error; });
    await g.c.runDiagnostics(false);
    assert.equal(JSON.stringify(g.stages).includes(secret), false);
  }
});

test('LoRA limits/conflicts and storage lock validation expose only fixed messages', async () => {
  const c = context(['parseLoras', 'mergeLoras', 'storageLock', 'describeFetchError'], { navigator: {} });
  for (const input of ['1:2', '1:0.5,1:0.6', Array.from({ length: 6 }, (_, i) => ({ modelId: String(i + 1), weight: 1 }))]) {
    assert.throws(() => c.parseLoras(input), error => /LoRA/.test(c.describeFetchError(error)));
  }
  await assert.rejects(c.storageLock(() => {}), error => /저장 잠금 미지원/.test(c.describeFetchError(error)));
  assert.throws(() => c.mergeLoras([{ loras: [{ modelId: '1', weight: 0.5 }] },
    { displayName: secret, loras: [{ modelId: '1', weight: 0.6 }] }], []),
  error => /LoRA 가중치 충돌/.test(c.describeFetchError(error)) && !c.describeFetchError(error).includes(secret));
});

test('create and poll report safe HTTP failures; remote task fields never enter logs', async () => {
  for (const status of [401, 403]) {
    const f = fixture(async url => new Response(secret, { status: url.endsWith('/0') ? 404 : status }));
    await assert.rejects(f.c.pixaiCreateTask(secret, secret, '1:1'), error => f.c.describeFetchError(error).includes(`HTTP ${status}`));
    await assert.rejects(f.c.pixaiWaitTask(secret), error => f.c.describeFetchError(error).includes(`HTTP ${status}`));
    assert.equal(JSON.stringify(f.stages).includes(secret), false);
  }
  const f = fixture(async url => new Response(url.endsWith('/0') ? '' : JSON.stringify({ id: secret, status: secret }), { status: url.endsWith('/0') ? 404 : 200 }));
  await f.c.pixaiCreateTask(secret, secret, '1:1');
  assert.equal(JSON.stringify(f.stages).includes(secret), false);
  f.c.checkedFetch = async () => new Response(secret);
  await assert.rejects(f.c.pixaiCreateTask(secret, '', '1:1'), error => !f.c.describeFetchError(error).includes(secret));
});

test('settings validation displays own errors and redacts unexpected runtime errors', async () => {
  const f = fixture(), click = saveButton(f.c);
  f.c.q('.pb-model').value = secret;
  await click();
  assert.match(f.stages.at(-1)[2], /모델 ID/);
  f.c.q('.pb-model').value = '123';
  f.c.parseLoras = () => { throw new Error(secret); };
  await click();
  assert.equal(JSON.stringify(f.stages).includes(secret), false);
  f.c.saveSettings = async () => { throw new Error(secret); };
  f.c.parseLoras = () => [];
  await click();
  assert.equal(JSON.stringify(f.stages).includes(secret), false);
});

test('settings startup LoRA sink uses the same safe error formatter', () => {
  const f = fixture();
  const start = source.indexOf('try { parseLoras(settings.loras)');
  const end = source.indexOf('q(".pb-lora-add")', start);
  f.c.settings.loras = 'invalid';
  vm.runInContext(source.slice(start, end), f.c);
  assert.match(f.stages.at(-1)[2], /LoRA/);
  f.c.parseLoras = () => { throw new Error(secret); };
  vm.runInContext(source.slice(start, end), f.c);
  assert.equal(JSON.stringify(f.stages).includes(secret), false);
});

test('selfie error response displays own validation, redacts runtime errors and sanitizes status', async () => {
  const c = context(['installSelfieAdapter', 'abortCaller', 'describeFetchError', 'parseLoras'], {
    window: { fetch: async () => assert.fail('must never resend native request') },
    settings: { selfieInterceptEnabled: true }, stopRevision: 0, stopped: false,
    matchSelfie: async () => ({ body: {} }), recordStage() {},
  });
  const cleanup = c.installSelfieAdapter();
  try {
    c.handleSelfie = async () => c.parseLoras('invalid');
    assert.match((await (await c.window.fetch('/fixture')).json()).error, /LoRA/);
    for (const error of [new Error(secret), Object.assign(new Error(secret), { status: secret }), null]) {
      c.handleSelfie = async () => { throw error; };
      const response = await c.window.fetch('/fixture');
      assert.equal(response.status, 502);
      assert.equal((await response.text()).includes(secret), false);
    }
  } finally { cleanup(); }
});

for (const failure of [401, 403, 'network']) test(`preflight ${failure} retries next call and never creates`, async () => {
  const f = fixture(async () => {
    if (failure === 'network') throw new TypeError(secret);
    return new Response(secret, { status: failure });
  });
  for (let i = 0; i < 2; i++) await assert.rejects(f.c.pixaiCreateTask(secret, '', '1:1'));
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(([url]) => url.endsWith('/0')));
});

for (const status of [400, 401, 403, 404, 422, 500]) test(`preflight policy table HTTP ${status}: creation, log and cache`, async () => {
  const f = fixture(async url => url.endsWith('/0')
    ? new Response(secret, { status }) : Response.json({ id: 'task' }));
  for (let i = 0; i < 2; i++) {
    if ([401, 403].includes(status)) {
      await assert.rejects(f.c.pixaiCreateTask(secret, '', '1:1'), error => {
        assert.match(f.c.describeFetchError(error), /키 확인 필요/);
        return true;
      });
    } else await f.c.pixaiCreateTask(secret, '', '1:1');
  }
  assert.equal(f.calls.filter(([, init]) => init.method === 'POST').length, [401, 403].includes(status) ? 0 : 2);
  assert.equal(f.calls.filter(([url]) => url.endsWith('/0')).length, status === 404 ? 1 : 2);
  assert.ok(f.stages.some(([stage, , detail]) => stage === 'pixai.preflight GET' && detail.includes(`HTTP ${status}`)));
  assert.equal(JSON.stringify(f.stages).includes(secret), false);
});

test('2xx/404 success reuse and concurrent probes share one in-flight request', async () => {
  for (const status of [200, 204, 299, 404]) {
    let resolve;
    const f = fixture(() => new Promise(r => { resolve = r; }));
    const a = f.c.ensureTaskAccess(), b = f.c.ensureTaskAccess();
    assert.equal(f.calls.length, 1);
    resolve(new Response(null, { status }));
    assert.deepEqual(await Promise.all([a, b]), [status, status]);
    assert.equal(await f.c.ensureTaskAccess(), status);
    assert.equal(f.calls.length, 1);
  }
});

test('concurrent rejected probes share, then retry to a reusable success', async () => {
  for (const network of [false, true]) {
    let finish;
    const f = fixture(() => new Promise((resolve, reject) => {
      finish = () => network ? reject(new TypeError(secret)) : resolve(new Response(null, { status: 401 }));
    }));
    const results = Promise.allSettled([f.c.ensureTaskAccess(), f.c.ensureTaskAccess()]);
    assert.equal(f.calls.length, 1);
    finish();
    assert.ok((await results).every(result => result.status === 'rejected'));
    let retried = 0;
    f.c.checkedFetch = async () => { retried++; return new Response(null, { status: 404 }); };
    await f.c.ensureTaskAccess(); await f.c.ensureTaskAccess();
    assert.equal(retried, 1);
  }
});

test('key identity alone invalidates success; invalid status values cannot be trusted or cached', async () => {
  const f = fixture();
  await f.c.ensureTaskAccess();
  f.c.apiKey = 'synthetic-key-b';
  await f.c.ensureTaskAccess();
  assert.equal(f.calls.length, 2);
  for (const status of [0, secret, '200', 200.5, undefined]) {
    const g = fixture(async () => ({ status }));
    for (let i = 0; i < 2; i++) await assert.rejects(g.c.ensureTaskAccess());
    assert.equal(g.calls.length, 2);
    assert.equal(JSON.stringify(g.stages).includes(secret), false);
  }
});

test('changing key and saving unchanged settings both invalidate a previous success', async () => {
  for (const changeKey of [false, true]) {
    const f = fixture(), click = saveButton(f.c);
    await click(); // Establish exactly the saved controls, so the next patch is empty.
    await f.c.ensureTaskAccess();
    if (changeKey) f.c.q('.pb-key').value = 'synthetic-key-b';
    await click();
    await f.c.ensureTaskAccess();
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1][1].headers.Authorization, `Bearer synthetic-key-${changeKey ? 'b' : 'a'}`);
  }
});

test('failed settings save preserves key and successful cache', async () => {
  const f = fixture(), click = saveButton(f.c);
  await f.c.ensureTaskAccess();
  f.c.q('.pb-key').value = 'synthetic-key-b';
  f.c.marinara.storage.patch = async () => { throw new Error(secret); };
  await click();
  await f.c.ensureTaskAccess();
  assert.equal(f.calls.length, 1);
  assert.equal(f.c.apiKey, 'synthetic-key-a');
});

test('old success/failure cannot corrupt a new cache after settings save or key change', async () => {
  for (const oldFirst of [false, true]) for (const changeKey of [false, true]) for (const oldStatus of [404, 403, 'network']) {
    const pending = [];
    const f = fixture(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
    const click = saveButton(f.c);
    const old = f.c.ensureTaskAccess().catch(error => error);
    if (changeKey) f.c.q('.pb-key').value = 'synthetic-key-b';
    await click();
    const fresh = f.c.ensureTaskAccess();
    assert.equal(pending.length, 2);
    const finishOld = async () => {
      if (oldStatus === 'network') pending[0].reject(new TypeError(secret));
      else pending[0].resolve(new Response(null, { status: oldStatus }));
      await old;
    };
    if (oldFirst) await finishOld();
    const shared = f.c.ensureTaskAccess();
    assert.equal(f.calls.length, 2, 'new in-flight probe remains shared');
    pending[1].resolve(new Response(null, { status: 404 }));
    await Promise.all([fresh, shared]);
    if (!oldFirst) await finishOld();
    assert.equal(await f.c.ensureTaskAccess(), 404);
    assert.equal(f.calls.length, 2);
  }
});
