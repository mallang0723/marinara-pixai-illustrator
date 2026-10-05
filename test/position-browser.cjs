// Real Chromium input/layout, offline storage and network-denied fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.join(process.env.MARINARA_REPO, 'package.json'))('@playwright/test');
const source = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../extension.css'), 'utf8');
const toggle = '.pixai-bridge-toggle', panel = '.pixai-bridge-panel', header = '.pb-drag-handle';
async function load(page) {
  await page.evaluate(async code => { window.cleanup = await new Function('marinara', `return (async () => {${code}\n})();`)(window.marinara); }, source);
}
async function inside(page, selector) {
  const box = await page.locator(selector).boundingBox(), v = page.viewportSize();
  assert.ok(box.x >= 7 && box.y >= 7 && box.x + box.width <= v.width - 7 && box.y + box.height <= v.height - 7, JSON.stringify({ box, v }));
  return box;
}
async function drag(page, selector, dx, dy, touch) {
  const box = await page.locator(selector).boundingBox();
  const x = box.x + box.width / 2, y = box.y + Math.min(15, box.height / 2);
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: y + dy * i / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up();
  }
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/sbin/chromium' });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1000, height: 800 }, hasTouch: mobile });
      const page = await context.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', r => r.abort());
      await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><button id="outside">outside</button></body>');
      await page.addStyleTag({ content: css });
      await page.evaluate(() => {
        window.saved = {}; window.writes = []; window.calls = 0;
        window.marinara = {
          storage: { get: async () => structuredClone(window.saved), patch: async p => {
            if (window.failStorage) throw new Error('fixture storage failure');
            window.writes.push(structuredClone(p)); Object.assign(window.saved, structuredClone(p));
          } },
          fetch: async () => { window.calls++; throw new Error('unexpected network'); },
          log: { info() {}, error() {}, warn() {} }, setInterval: () => 1, clearInterval() {},
        };
      });
      await load(page);
      const initial = await inside(page, toggle);
      await drag(page, toggle, -100, -120, mobile);
      const moved = await inside(page, toggle);
      assert.ok(Math.abs(moved.x - initial.x + 100) < 2, 'button must move');
      assert.equal(await page.locator(panel).isVisible(), false, 'drag must not click-open');
      await page.waitForFunction(() => window.saved.uiPosition?.button);
      assert.equal(await page.evaluate(() => window.writes.length), 1, 'one write per drag, not per move');
      await page.evaluate(() => window.cleanup()); await load(page);
      assert.deepEqual(await page.locator(toggle).boundingBox(), moved, 'reload restores button');
      // A tiny move remains a tap/click, including touch-generated click.
      await drag(page, toggle, 2, 1, mobile);
      await page.waitForFunction(() => !document.querySelector('.pixai-bridge-panel').hidden);
      assert.equal(await page.locator(panel).isVisible(), true);
      const near = await inside(page, panel);
      assert.ok(near.x <= moved.x + moved.width && near.x + near.width >= moved.x);
      assert.equal(await page.locator(toggle).getAttribute('aria-expanded'), 'true');
      if (mobile) {
        const b = await page.locator(toggle).boundingBox();
        await page.touchscreen.tap(b.x + 18, b.y + 18);
        assert.equal(await page.locator(panel).isVisible(), false, 'native touch click must not double-toggle');
        await page.touchscreen.tap(b.x + 18, b.y + 18);
        assert.equal(await page.locator(panel).isVisible(), true);
      }
      await drag(page, header, mobile ? 10 : -120, 70, mobile);
      const panelMoved = await inside(page, panel);
      assert.ok(panelMoved.y > near.y + 10, 'header moves panel');
      await page.waitForFunction(() => window.saved.uiPosition?.panel);
      await page.evaluate(() => window.cleanup()); await load(page);
      await page.locator(toggle).focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.locator(panel).boundingBox(), panelMoved, 'reload restores panel');
      await page.keyboard.press('Space'); assert.equal(await page.locator(panel).isVisible(), false);
      await page.keyboard.press('Enter'); assert.equal(await page.locator(panel).isVisible(), true);
      if (process.env.POSITION_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.POSITION_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.POSITION_SCREENSHOT_DIR, mobile ? 'position-mobile.png' : 'position-desktop.png') });
      }
      assert.equal(await page.locator(toggle).evaluate(e => getComputedStyle(e).touchAction), 'none');
      assert.equal(await page.locator(header).evaluate(e => getComputedStyle(e).touchAction), 'none');
      assert.notEqual(await page.locator(panel).evaluate(e => getComputedStyle(e).touchAction), 'none');
      if (mobile) {
        // Body swipes scroll the panel, not its fixed position or the page.
        const before = await page.locator(panel).boundingBox();
        await drag(page, '.pixai-bridge-panel p', 0, -100, true);
        await page.waitForFunction(() => document.querySelector('.pixai-bridge-panel').scrollTop > 0);
        assert.deepEqual(await page.locator(panel).boundingBox(), before);
      }
      await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 390, height: 300 });
      await page.waitForFunction(() => document.querySelector('.pixai-bridge-panel').getBoundingClientRect().bottom <= innerHeight);
      await inside(page, toggle); await inside(page, panel);
      await page.locator('.pb-position-reset').click();
      await page.waitForFunction(() => window.saved.uiPosition === null);
      const reset = await inside(page, toggle);
      assert.ok(reset.x > page.viewportSize().width - 60);
      await inside(page, panel);
      // Failed position save is visible and does not claim persistence.
      await page.evaluate(() => { window.failStorage = true; });
      await page.locator(toggle).click(); // close
      await drag(page, toggle, -60, -50, mobile);
      await page.waitForFunction(() => document.querySelector('.pixai-bridge-log').textContent.includes('위치 저장 실패'));
      assert.equal(await page.evaluate(() => window.saved.uiPosition), null);
      // Cancellation must roll back motion and never write a position.
      await page.evaluate(() => { window.failStorage = false; });
      const beforeCancel = await page.locator(toggle).boundingBox();
      const writesBeforeCancel = await page.evaluate(() => window.writes.length);
      await page.mouse.move(beforeCancel.x + 18, beforeCancel.y + 18); await page.mouse.down();
      await page.mouse.move(beforeCancel.x + 35, beforeCancel.y + 35);
      await page.locator(toggle).dispatchEvent('pointercancel', { pointerId: 1 });
      await page.mouse.up();
      assert.deepEqual(await page.locator(toggle).boundingBox(), beforeCancel);
      assert.equal(await page.evaluate(() => window.writes.length), writesBeforeCancel);
      await page.evaluate(() => window.cleanup());
      const writes = await page.evaluate(() => window.writes.length);
      await page.setViewportSize({ width: 600, height: 600 });
      assert.equal(await page.locator('.pixai-bridge-root').count(), 0);
      assert.equal(await page.evaluate(() => window.writes.length), writes);
      assert.equal(await page.evaluate(() => window.calls), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${mobile ? '390px touch + rotation' : 'desktop mouse + resize'}: drag/tap, clamp, save/reload, header, reset, keyboard, touch-action, cleanup`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
