// Offline transport fixtures: never contact PixAI or create a paid image.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
function helper(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `missing helper ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function fixture(fetch) {
  const calls = [], stages = [];
  const ctx = vm.createContext({
    TypeError, URL, Blob, PIXAI_BASE: 'https://api.pixai.art', POLL_TASK_MS: 0, TASK_TIMEOUT_MS: 1000,
    MAX_IMAGE_BYTES: 20 * 1024 * 1024, MAX_PROMPT_CHARS: 2000,
    ASPECT_RATIOS: ['1:1'], DEFAULTS: { aspectRatio: '1:1' },
    settings: { modelVersionId: '123', loras: [] }, taskAccessCheck: null,
    stopped: false, busy: false, isLeader: true, apiKey: 'fixture-not-a-key', confirm: () => true,
    ensureRunning() {}, delay: async () => {}, pixaiHeaders: () => ({ Authorization: 'Bearer fixture-not-a-key' }),
    recordStage: (...args) => stages.push(args),
    checkedFetch: async (url, init = {}) => { calls.push({ url, ...init }); return fetch(url, init); },
  });
  vm.runInContext(['describeFetchError', 'truncatePrompt', 'parseLoras', 'ensureTaskAccess',
    'pixaiCreateTask', 'pixaiWaitTask', 'runDiagnostics', 'safeMediaUrl', 'pixaiDownload'].map(helper).join('\n'), ctx);
  return { ctx, calls, stages };
}
const completed = { status: 'completed', outputs: { mediaIds: ['123'], mediaUrls: ['https://d2doj8oszwtcqy.cloudfront.net/fixture.png'] }, paidQuota: 10 };
test('download prefers CDN without credentials and explains legacy domain failures', async () => {
  const good = fixture(async () => new Response('fixture-image', { headers: { 'content-type': 'image/png' } }));
  await good.ctx.pixaiDownload(completed);
  assert.equal(good.calls.length, 1);
  assert.equal(good.calls[0].url, completed.outputs.mediaUrls[0]);
  assert.equal(Object.keys(good.calls[0].headers).length, 0);
  for (const failure of [new TypeError('fixture CORS'), 400]) {
    const f = fixture(async () => {
      if (failure instanceof TypeError) throw failure;
      return new Response('', { status: failure });
    });
    await assert.rejects(f.ctx.pixaiDownload(completed));
    assert.equal(f.calls.length, 2);
    assert.ok(f.stages.some(x => x[2].includes('v1 media') && x[2].includes('도메인 Origin')));
  }
});
test('diagnostic 1 probes v2 without create and shares cached reachability with create', async () => {
  for (const status of [200, 401, 404]) {
    const { ctx, calls } = fixture(async url => url.endsWith('/task/0')
      ? new Response('', { status }) : new Response('{"id":"fixture"}'));
    await ctx.runDiagnostics(false);
    assert.deepEqual(calls.map(x => x.url), ['https://api.pixai.art/v2/task/0']);
    await ctx.pixaiCreateTask('fixture', '', '1:1');
    await ctx.pixaiCreateTask('fixture', '', '1:1');
    assert.deepEqual(calls.map(x => x.method || 'GET'), ['GET', 'POST', 'POST']);
  }
});
test('paid diagnostic cannot create when result access is blocked', async () => {
  const { ctx, calls } = fixture(async () => { throw new TypeError('fixture CORS'); });
  await ctx.runDiagnostics(true);
  assert.equal(ctx.busy, false);
  assert.deepEqual(calls.map(x => x.url), ['https://api.pixai.art/v2/task/0']);
});
test('CORS probe failure is session-cached and prevents every paid create', async () => {
  const { ctx, calls, stages } = fixture(async url => {
    if (url.endsWith('/v2/task/0')) throw new TypeError('fixture CORS');
    return new Response('{"id":"unexpected-paid-task"}');
  });
  for (let i = 0; i < 2; i++) await assert.rejects(ctx.pixaiCreateTask('fixture', '', '1:1'));
  assert.deepEqual(calls.map(x => x.url), ['https://api.pixai.art/v2/task/0']);
  assert.ok(stages.some(x => x[2].includes('네트워크/CORS 오류 가능') && x[2].includes('새로고침 후 다시 시도')));
});
test('v2 404 alone falls back to v1; other HTTP and transport errors never do', async () => {
  const { ctx, calls } = fixture(async url => url.includes('/v2/')
    ? new Response('', { status: 404 }) : new Response(JSON.stringify(completed)));
  assert.equal((await ctx.pixaiWaitTask('123')).status, 'completed');
  assert.deepEqual(calls.map(x => x.url), ['https://api.pixai.art/v2/task/123', 'https://api.pixai.art/v1/task/123']);
  for (const status of [400, 401, 403, 429, 500]) {
    const f = fixture(async () => new Response('', { status }));
    await assert.rejects(f.ctx.pixaiWaitTask('123'), new RegExp(String(status)));
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(async () => { throw new TypeError('fixture CORS'); });
  await assert.rejects(f.ctx.pixaiWaitTask('123'), TypeError);
  assert.equal(f.calls.length, 1);
});
test('poll uses v2 task and consumes common completion/output fields', async () => {
  const { ctx, calls } = fixture(async () => new Response(JSON.stringify(completed)));
  const result = await ctx.pixaiWaitTask('123/456');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.outputs, completed.outputs);
  assert.deepEqual(calls.map(x => x.url), ['https://api.pixai.art/v2/task/123%2F456']);
  assert.equal(calls[0].credentials, 'omit');
  assert.equal(calls[0].redirect, 'error');
});
