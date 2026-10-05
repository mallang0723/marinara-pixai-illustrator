const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.join(process.env.MARINARA_REPO, 'package.json'))('@playwright/test');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/usr/sbin/chromium' });
  try {
    for (const scenario of ['on', 'off', 'missing-key', 'duplicate-agent', 'follower', 'stop-during-bind']) {
      const page = await browser.newPage();
      await page.route('**/*', r => r.abort());
      await page.setContent('<html><body></body></html>');
      await page.evaluate(scenario => {
        window.saved = { enabled: scenario !== 'off', rememberKey: true, apiKey: scenario === 'missing-key' ? '' : 'fixture-only' };
        window.created = 0;
        window.agentReads = 0;
        window.runs = [];
        Object.defineProperty(window, 'localStorage', { value: { getItem: () => 'chat' } });
        Object.defineProperty(navigator, 'locks', { value: { request: async (name, options, cb) => cb(scenario === 'follower' ? null : {}) } });
        window.marinara = {
          storage: { get: async () => structuredClone(window.saved), patch: async p => Object.assign(window.saved, structuredClone(p)) },
          fetch: async (url) => {
            if (url === '/api/agents') {
              window.agentReads++;
              if (scenario === 'stop-during-bind') await new Promise(r => { window.releaseBind = r; });
              const agent = { id: 'director', name: 'PixAI Director', type: 'custom-fixture' };
              return new Response(JSON.stringify(scenario === 'duplicate-agent' ? [agent, agent] : [agent]));
            }
            if (url.includes('/agents/runs/')) return new Response(JSON.stringify(window.runs));
            if (url.endsWith('/v2/task/0')) return new Response('', { status: 404 });
            if (url.endsWith('/v2/image/create')) { window.created++; return new Response('{}', { status: 400 }); }
            throw new Error('Unexpected fixture route');
          },
          log: { info() {}, error() {}, warn() {} },
          setInterval: fn => { window.tick = fn; return 1; }, clearInterval() {},
        };
      }, scenario);
      await page.evaluate(async code => { window.cleanup = await new Function('marinara', `return (async () => {${code}\n})();`)(window.marinara); }, source);
      await page.click('.pixai-bridge-toggle');
      assert.equal(await page.isChecked('.pb-enabled'), scenario !== 'off', `saved toggle: ${scenario}`);
      if (scenario === 'stop-during-bind') {
        await page.waitForFunction(() => !!window.releaseBind);
        await page.click('.pb-clear');
        await page.evaluate(() => window.releaseBind());
      }
      if (scenario === 'on') await page.waitForFunction(() => document.querySelector('.pixai-bridge-status').textContent.startsWith('ON'));
      await page.evaluate(() => {
        const run = { chatId: 'chat', agentConfigId: 'director', resultType: 'context_injection', resultData: { text: 'PIXAI_PROMPT: fixture' } };
        window.runs = [{ ...run, id: 'new', createdAt: new Date(Date.now() + 1000).toISOString() }, { ...run, id: 'old', createdAt: '2000-01-01T00:00:00Z' }];
        window.tick();
      });
      if (scenario === 'on') {
        await page.waitForFunction(() => window.created === 1);
        assert.deepEqual(await page.evaluate(() => window.saved.processedRunIds), ['new']);
        await page.evaluate(() => window.tick());
        assert.equal(await page.evaluate(() => window.created), 1);
      } else {
        assert.equal(await page.evaluate(() => window.created), 0, scenario);
        assert.match(await page.textContent('.pixai-bridge-status'), /^OFF · .+/);
      }
      if (scenario === 'missing-key' || scenario === 'off') {
        await page.evaluate(() => { window.beforeEnable = new Date().toISOString(); });
        await page.fill('.pb-key', 'fixture-only');
        await page.check('.pb-enabled');
        await page.click('.pb-save');
        await page.waitForFunction(() => document.querySelector('.pixai-bridge-status').textContent.startsWith('ON'));
        await page.evaluate(() => {
          window.runs[1].createdAt = window.beforeEnable;
          window.runs[0].createdAt = new Date(Date.now() + 1000).toISOString();
          window.tick();
        });
        await page.waitForFunction(() => window.saved.processedRunIds?.includes('new'));
        assert.deepEqual(await page.evaluate(() => window.saved.processedRunIds), ['new'], 'manual enable excludes runs from the paused period');
      }
      await page.evaluate(() => window.cleanup());
      await page.close();
    }
    console.log('PASS reload fixture: saved ON/OFF, fresh-only runs, no duplicate billing, missing key/duplicate Director/follower blocked, stop wins pending bind, OFF reason');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
