const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const marinaraRepo = process.env.MARINARA_REPO;
if (!marinaraRepo) throw new Error('Set MARINARA_REPO to a checkout with @playwright/test');
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/sbin/chromium';
const screenshotDir = path.resolve(process.env.SCREENSHOT_DIR || path.join(__dirname, '../../screenshots'));
const fixturePath = path.join(__dirname, 'fixture.html');
const extensionPath = path.join(__dirname, '../extension.js');
const stylesheetPath = path.join(__dirname, '../extension.css');

if (!fs.existsSync(path.join(marinaraRepo, 'package.json'))) {
  throw new Error(`MARINARA_REPO does not contain package.json: ${marinaraRepo}`);
}

const { chromium } = createRequire(path.join(marinaraRepo, 'package.json'))('@playwright/test');
const fixtureHtml = fs.readFileSync(fixturePath, 'utf8');
const extensionSource = fs.readFileSync(extensionPath, 'utf8');
const extensionCss = fs.readFileSync(stylesheetPath, 'utf8');

fs.mkdirSync(screenshotDir, { recursive: true });

const outputs = [];

async function createFixturePage(browser) {
  const page = await browser.newPage({
    viewport: { width: 480, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  const browserRequests = [];

  page.on('request', request => browserRequests.push(request.url()));
  await page.route('**/*', route => route.abort('blockedbyclient'));
  await page.setContent(fixtureHtml, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: extensionCss });
  await page.evaluate(() => {
    const clonedInitialState = {};
    let timerId = 0;
    const timers = new Set();

    window.__fixtureState = {
      browserFetchCalls: [],
      logCalls: [],
      saved: clonedInitialState,
      timers,
    };
    window.marinara = {
      storage: {
        get: async () => structuredClone(clonedInitialState),
        patch: async patch => Object.assign(window.__fixtureState.saved, structuredClone(patch)),
      },
      fetch: async (url, init = {}) => {
        window.__fixtureState.browserFetchCalls.push({
          url: String(url),
          method: String(init.method || 'GET').toUpperCase(),
        });
        throw new Error('Fixture network is disabled');
      },
      log: {
        info: (...args) => window.__fixtureState.logCalls.push(['info', ...args.map(String)]),
        warn: (...args) => window.__fixtureState.logCalls.push(['warn', ...args.map(String)]),
        error: (...args) => window.__fixtureState.logCalls.push(['error', ...args.map(String)]),
      },
      setInterval: () => {
        const id = ++timerId;
        timers.add(id);
        return id;
      },
      clearInterval: id => timers.delete(id),
      setTimeout: () => ++timerId,
      clearTimeout: () => {},
    };
    window.confirm = () => false;
  });
  await page.evaluate(async source => {
    window.__fixtureCleanup = await new Function(
      'marinara',
      `return (async () => {${source}\n})();`,
    )(window.marinara);
  }, extensionSource);
  await page.locator('.pixai-bridge-toggle').click();
  await page.locator('.pixai-bridge-panel').waitFor({ state: 'visible' });

  return { page, browserRequests };
}

async function assertCommon(page, browserRequests) {
  assert.equal(
    await page.locator('.mock-banner').textContent(),
    '모의 화면 · 실제 API 호출 없음',
    'fixture-only banner must remain visible',
  );
  assert.equal(await page.locator('.mock-banner').isVisible(), true, 'fixture-only banner must be visible');
  assert.equal(await page.locator('.pixai-bridge-panel').isVisible(), true, 'extension panel must be open');
  assert.equal(await page.inputValue('.pb-key'), '', 'API key input must remain blank');
  assert.deepEqual(browserRequests, [], 'the browser must make no network requests');
  assert.deepEqual(
    await page.evaluate(() => window.__fixtureState.browserFetchCalls),
    [],
    'the fake marinara.fetch must not be called',
  );
}

async function saveScreenshot(page, filename) {
  const outputPath = path.join(screenshotDir, filename);
  const image = await page.screenshot({ path: outputPath, animations: 'disabled' });
  assert.equal(image.subarray(1, 4).toString('ascii'), 'PNG', `${filename} must be a PNG`);
  assert.ok(image.length > 10_000, `${filename} should contain a rendered interface`);
  outputs.push({ filename, outputPath, bytes: image.length });
}

async function closeFixturePage(page) {
  await page.evaluate(() => window.__fixtureCleanup());
  assert.equal(await page.locator('.pixai-bridge-root').count(), 0, 'extension cleanup should remove the panel');
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath });
  try {
    {
      const { page, browserRequests } = await createFixturePage(browser);
      assert.equal(await page.locator('.pb-model-preset').inputValue(), '1983308862240288769');
      assert.equal(await page.locator('.pb-lora-row').count(), 0);
      assert.match(await page.locator('.pixai-bridge-status').textContent(), /^OFF · 자동 처리 설정 꺼짐 · key ✗ · chat ✗$/);
      await assertCommon(page, browserRequests);
      await saveScreenshot(page, '01-default.png');
      await closeFixturePage(page);
    }

    {
      const { page, browserRequests } = await createFixturePage(browser);
      await page.selectOption('.pb-model-preset', '1861558740588989558');
      await page.locator('.pb-lora-add').click();
      await page.locator('.pb-lora-add').click();
      await page.locator('.pb-lora-id').nth(0).fill('1111111111111111111');
      await page.locator('.pb-lora-weight').nth(0).fill('0.7');
      await page.locator('.pb-lora-id').nth(1).fill('2222222222222222222');
      await page.locator('.pb-lora-weight').nth(1).fill('0.5');
      assert.equal(await page.locator('.pb-model-preset option:checked').textContent(), 'Haruka v2');
      assert.deepEqual(await page.locator('.pb-lora-id').evaluateAll(inputs => inputs.map(input => input.value)), [
        '1111111111111111111',
        '2222222222222222222',
      ]);
      assert.deepEqual(await page.locator('.pb-lora-weight').evaluateAll(inputs => inputs.map(input => input.value)), ['0.7', '0.5']);
      await assertCommon(page, browserRequests);
      await saveScreenshot(page, '02-model-loras.png');
      await closeFixturePage(page);
    }

    {
      const { page, browserRequests } = await createFixturePage(browser);
      const mockLogLines = [
        'MOCK · 진단 GET · 모의 네트워크 점검 (요청 전송 안 함)',
        'MOCK · 에이전트 처리 · fixture 대기 상태',
        'MOCK · pixai.create POST · 실행 안 함 · API 호출 없음',
        'MOCK · 갤러리 첨부 · 실행 안 함 · 결과 생성 없음',
      ];
      await page.locator('.pixai-bridge-log').evaluate((element, lines) => {
        element.textContent = lines.join('\n');
        element.dataset.fixtureMock = 'true';
      }, mockLogLines);
      await page.locator('.pixai-bridge-log').scrollIntoViewIfNeeded();
      await page.locator('.pixai-bridge-panel').evaluate(panel => {
        panel.scrollTop = panel.scrollHeight;
      });
      const renderedLogLines = (await page.locator('.pixai-bridge-log').textContent()).split('\n');
      assert.deepEqual(renderedLogLines, mockLogLines);
      assert.equal(renderedLogLines.every(line => line.startsWith('MOCK ·')), true);
      assert.equal(await page.locator('.pixai-bridge-log').getAttribute('data-fixture-mock'), 'true');
      await assertCommon(page, browserRequests);
      await saveScreenshot(page, '03-mock-logs.png');
      await closeFixturePage(page);
    }

    for (const output of outputs) {
      console.log(`PASS ${output.filename} (${output.bytes} bytes) -> ${output.outputPath}`);
    }
    console.log('PASS assertions: 480x900 viewport, open panel, visible Korean mock banner, blank API key, zero browser/fake-fetch requests');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
