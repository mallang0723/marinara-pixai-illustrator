const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const repo = process.env.MARINARA_REPO;
if (!repo) throw new Error('Set MARINARA_REPO to a checkout with @playwright/test installed');
const { chromium } = createRequire(path.join(repo, 'package.json'))('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/sbin/chromium' });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort()); // hard network deny; not a Marinara instance
    await page.setContent('<!doctype html><html><body><p id="outside">fixture only</p></body></html>');
    await page.evaluate(() => {
      window.saved = {};
      window.calls = [];
      window.logs = [];
      window.marinara = {
        storage: { get: async () => structuredClone(window.saved), patch: async patch => {
          if (window.failStorage) throw new Error('fixture-only-not-a-real-key');
          Object.assign(window.saved, structuredClone(patch));
        } },
        fetch: async (url, init = {}) => {
          window.calls.push({ url, body: init.body });
          if (url.endsWith('/v2/image/create')) return new Response(JSON.stringify({ id: 'fixture-task' }), { status: 201 });
          if (url.includes('/v1/task/')) return new Response(JSON.stringify({ status: 'completed', outputs: {} }));
          throw new Error('Unexpected fixture request');
        },
        log: Object.fromEntries(['info', 'error', 'warn'].map(level => [level, (...args) => window.logs.push(args)])),
        setInterval: () => 1, clearInterval() {}, setTimeout: callback => { callback(); },
      };
      window.confirm = () => true;
    });
    const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
    await page.evaluate(async code => { window.cleanup = await new Function('marinara', `return (async () => {${code}\n})();`)(window.marinara); }, source);
    await page.click('.pixai-bridge-toggle');
    assert.equal(await page.isChecked('.pb-remember'), true, 'remember key defaults on');
    await page.fill('.pb-key', 'fixture-only-not-a-real-key');
    await page.click('.pb-save');
    assert.equal(await page.evaluate(() => window.saved.apiKey === 'fixture-only-not-a-real-key'), true);
    await page.evaluate(() => { window.failStorage = true; });
    await page.click('.pb-save');
    await page.click('.pb-delete-key');
    assert.equal(await page.evaluate(() => window.saved.apiKey === 'fixture-only-not-a-real-key'), true, 'failed delete does not claim success');
    assert.equal(await page.isChecked('.pb-enabled'), false);
    assert.equal(await page.evaluate(() => JSON.stringify(window.logs).includes('fixture-only-not-a-real-key')), false);
    assert.equal((await page.textContent('.pixai-bridge-log')).includes('fixture-only-not-a-real-key'), false);
    await page.evaluate(() => { window.failStorage = false; });
    await page.evaluate(() => window.cleanup());
    await page.evaluate(async code => { window.cleanup = await new Function('marinara', `return (async () => {${code}\n})();`)(window.marinara); }, source);
    await page.click('.pixai-bridge-toggle');
    assert.equal(await page.evaluate(() => document.querySelector('.pb-key').value === 'fixture-only-not-a-real-key'), true);
    assert.equal(await page.isChecked('.pb-enabled'), false, 'saved OFF stays OFF on reload');
    await page.uncheck('.pb-remember');
    await page.click('.pb-save');
    assert.equal(await page.evaluate(() => window.saved.apiKey === '' && window.saved.rememberKey === false), true);
    await page.evaluate(() => window.cleanup());
    await page.evaluate(async code => { window.cleanup = await new Function('marinara', `return (async () => {${code}\n})();`)(window.marinara); }, source);
    await page.click('.pixai-bridge-toggle');
    assert.equal(await page.inputValue('.pb-key'), '');
    assert.equal(await page.isChecked('.pb-remember'), false);
    await page.check('.pb-remember');
    await page.fill('.pb-key', 'fixture-only-not-a-real-key');
    await page.click('.pb-save');
    await page.click('.pb-delete-key');
    assert.equal(await page.evaluate(() => window.saved.apiKey === '' && window.saved.rememberKey === false), true);
    assert.equal(await page.inputValue('.pb-key'), '');
    await page.click('.pb-save');
    assert.equal(await page.evaluate(() => window.saved.apiKey === ''), true, 'later save cannot resurrect key');
    assert.equal(await page.locator('.pb-model-preset option').count(), 4);
    await page.selectOption('.pb-model-preset', '1861558740588989558');
    assert.equal(await page.inputValue('.pb-model'), '1861558740588989558');
    await page.selectOption('.pb-model-preset', 'custom');
    await page.fill('.pb-model', '9999999999999999999');
    await page.click('.pb-lora-add');
    await page.locator('.pb-lora-id').fill('1744880666293972790');
    await page.locator('.pb-lora-weight').fill('0.7');
    await page.click('.pb-save');
    await page.waitForFunction(() => window.saved.loras?.length === 1);
    assert.deepEqual(await page.evaluate(() => window.saved.loras), [{ modelId: '1744880666293972790', weight: 0.7 }]);
    assert.equal(await page.evaluate(() => window.saved.modelVersionId), '9999999999999999999');
    await page.fill('.pb-model', '<img src=x onerror=alert(1)>');
    await page.click('.pb-save');
    assert.equal(await page.evaluate(() => window.saved.modelVersionId), '9999999999999999999');
    assert.equal(await page.locator('.pixai-bridge-root img').count(), 0);
    await page.fill('.pb-model', '9999999999999999999');
    await page.locator('.pb-lora-weight').fill('1.1');
    await page.click('.pb-save');
    assert.equal(await page.evaluate(() => window.saved.loras[0].weight), 0.7);
    await page.locator('.pb-lora-remove').click();
    await page.click('.pb-save');
    await page.waitForFunction(() => window.saved.loras?.length === 0);
    await page.evaluate(() => window.cleanup());
    assert.equal(await page.locator('.pixai-bridge-root').count(), 0);
    assert.equal(await page.textContent('#outside'), 'fixture only');
    assert.equal(await page.evaluate(() => window.calls.length), 0);
    console.log('PASS browser fixture: default remember, reload, opt-out, deletion, failed save/delete redaction, billing OFF, model/LoRA regression, cleanup, zero network');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
