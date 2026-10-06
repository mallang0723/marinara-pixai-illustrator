// Full extension + actual UI handlers, synthetic transport and hard network deny.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { installFixture } = require('./selfie-fixture.cjs');
const { chromium } = createRequire(path.join(process.env.MARINARA_REPO, 'package.json'))('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/sbin/chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', r => r.request().url() === 'https://fixture.test/'
      ? r.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }) : r.abort());
    await page.goto('https://fixture.test/');
    await page.evaluate(installFixture);
    await page.evaluate(() => {
      const original = window.fetch;
      window.probes = 0;
      window.probeStatus = 401;
      window.fetch = async (url, init) => {
        if (String(url).endsWith('/v2/task/0')) {
          window.probes++;
          if (window.probeStatus === 'network') throw new TypeError('PRIVATE-REMOTE-BODY');
          return new Response('PRIVATE-REMOTE-BODY', { status: window.probeStatus });
        }
        return original(url, init);
      };
    });
    const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
    await page.evaluate(async code => { window.cleanup = await new Function('marinara', `return (async()=>{${code}\n})();`)(window.marinara); }, source);
    await page.click('.pixai-bridge-toggle');
    for (const [selector, status] of [['.pb-diag1', 401], ['.pb-diag2', 403]]) {
      await page.evaluate(value => { window.probeStatus = value; }, status);
      await page.click(selector);
      await page.waitForFunction(value => {
        const log = document.querySelector('.pixai-bridge-log').textContent;
        return log.includes(`조회 사전 확인 HTTP ${value}`) && log.includes(`pixai.preflight GET: HTTP ${value}`);
      }, status);
    }
    assert.equal(await page.evaluate(() => window.probes), 2, 'failed preflight is retried without reload');
    await page.evaluate(() => { window.probeStatus = 'network'; });
    await page.click('.pb-diag1');
    await page.waitForFunction(() => document.querySelector('.pixai-bridge-log').textContent.includes('네트워크/CORS'));
    await page.evaluate(() => { window.probeStatus = 404; });
    await page.click('.pb-diag1');
    await page.waitForFunction(() => window.probes === 4 && document.querySelector('.pixai-bridge-log').textContent.includes('HTTP 404'));
    await page.click('.pb-diag1');
    assert.equal(await page.evaluate(() => window.probes), 4, 'successful preflight reused');
    await page.click('.pb-save');
    await page.waitForFunction(() => document.querySelector('.pixai-bridge-log').textContent.includes('saved (key'));
    await page.click('.pb-diag1');
    await page.waitForFunction(() => window.probes === 5);
    await page.fill('.pb-key', 'synthetic-new-key');
    await page.click('.pb-save');
    await page.waitForFunction(() => window.saved.apiKey === 'synthetic-new-key');
    await page.click('.pb-diag1');
    await page.waitForFunction(() => window.probes === 6);
    await page.selectOption('.pb-model-preset', 'custom');
    await page.fill('.pb-model', 'PRIVATE-MODEL-INPUT');
    await page.click('.pb-save');
    await page.waitForFunction(() => document.querySelector('.pixai-bridge-log').textContent.includes('모델 ID는 양의 정수'));
    const evidence = await page.evaluate(() => ({ text: document.querySelector('.pixai-bridge-log').textContent, logs: window.logs, calls: window.calls }));
    assert.doesNotMatch(JSON.stringify({ text: evidence.text, logs: evidence.logs }), /PRIVATE-|synthetic-new-key/);
    assert.equal(evidence.calls.filter(c => c.url.endsWith('/v2/image/create')).length, 0);
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.cleanup());
    console.log('PASS diagnostics browser: visible 401/403, failure retry, success cache, same-key Save/key-change invalidation, model error, redaction, create=0');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
