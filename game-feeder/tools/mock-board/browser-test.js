'use strict';
// Actual CDP Input.dispatchMouseEvent, never DOM .click(). Installed Edge; no remote network.
// Start server.js first. PLAYWRIGHT_MODULE can point to an already-installed Playwright package.
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.MOCK_BOARD_URL || 'http://127.0.0.1:8866';
const SHOTS = process.env.SHOTS_DIR || path.resolve(__dirname, '../../../shots');
(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const before = await fetch(BASE + '/__mock/status').then(r => r.json());
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', route => { const url = new URL(route.request().url()); return url.origin === new URL(BASE).origin || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort(); });
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    async function mouse(locator) {
      await locator.waitFor({ state: 'visible' }); const box = await locator.boundingBox(); assert.ok(box);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    const text = async () => page.locator('.tl-board-panel').innerText();
    await page.goto(BASE); await page.locator('#run:enabled').waitFor();
    assert.equal(await page.getByRole('button', { name: '關卡庫即將開放' }).isDisabled(), true);
    await mouse(page.locator('#run')); await page.locator('#result[open]').waitFor();
    assert.match(await page.locator('#resultScore').innerText(), /3321/); await page.screenshot({ path: path.join(SHOTS, '01-custom-result.png') });
    await mouse(page.getByRole('button', { name: '排行榜', exact: true })); await page.getByText('登入後可上傳', { exact: false }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, '02-not-signed-in.png') });
    await mouse(page.getByRole('link', { name: '登入', exact: true })); await page.getByRole('button', { name: '上傳本局成績' }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, '03-fake-login.png') });
    await mouse(page.getByRole('button', { name: '上傳本局成績' })); await page.getByText('我的名次：1', { exact: true }).waitFor();
    assert.match(await text(), /Mock player/); await page.screenshot({ path: path.join(SHOTS, '04-my-rank.png') });
    // Use the actual copied mode page, with response-only bridge and its existing fast-forward hook.
    await page.goto(BASE + '/__mock/m1#intro=0&map=l4&layout=0-1-2&t=999999'); await page.locator('#result[open]').waitFor();
    await mouse(page.getByRole('button', { name: '排行榜', exact: true })); await page.getByRole('button', { name: '上傳本局成績' }).waitFor();
    await mouse(page.getByRole('button', { name: '上傳本局成績' })); await page.getByText('我的名次：1', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, '05-actual-mode1-challenge.png') });
    // Confirm teaching page does not grow a leaderboard button.
    await page.goto(BASE + '/__mock/m1?case=teaching#intro=0&map=l1&layout=0-1-2&t=999999'); await page.locator('#result[open]').waitFor();
    assert.equal(await page.getByRole('button', { name: '排行榜', exact: true }).count(), 0);
    for (const mode of [1, 2, 3, 4]) {
      await page.goto(BASE); await page.locator('#run:enabled').waitFor(); await mouse(page.locator('[data-pack-mode="' + mode + '"]'));
      await page.locator('#lvIntro[open]').waitFor();
      await page.waitForFunction(() => window.TL_ACTIVE_PACK && document.querySelector('#ivBody').textContent.includes('這是本機保存的關卡包。'));
      const actual = await page.evaluate(() => ({ id: TL_ACTIVE_PACK.id, mode: TL_ACTIVE_PACK.mode, title: (document.querySelector('#ivTitle') || document.querySelector('#lvIntro h2')).textContent, demos: [...document.scripts].filter(s => /\/demo(?:-plans)?\.js$/.test(s.src)).length }));
      assert.equal(actual.mode, mode); assert.match(actual.id, /^custom-/); assert.equal(actual.demos, 0); assert.ok(actual.title.length > 0);
      await page.screenshot({ path: path.join(SHOTS, '09-pack-mode' + mode + '-intro.png') });
    }
    // English and simplified Chinese panel text via actual language buttons in the fixture.
    await page.goto(BASE); await page.locator('#run:enabled').waitFor(); await mouse(page.getByRole('button', { name: 'English', exact: true }));
    await mouse(page.locator('#run')); await mouse(page.getByRole('button', { name: 'Leaderboard', exact: true })); await page.getByText('My rank: 1', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(SHOTS, '06-english.png') });
    await mouse(page.locator('.tl-board-panel').getByRole('button', { name: 'Close', exact: true })); await mouse(page.locator('#dismiss'));
    await mouse(page.getByRole('button', { name: '简体', exact: true })); await mouse(page.locator('#run')); await mouse(page.getByRole('button', { name: '排行榜', exact: true }));
    await page.getByText('我的名次：1', { exact: true }).waitFor(); await page.screenshot({ path: path.join(SHOTS, '07-simplified.png') });
    const status = await fetch(BASE + '/__mock/status').then(r => r.json()); assert.equal(status.uploads - before.uploads, 2);
    await fetch(BASE + '/__mock/stop', { method: 'POST' }).then(r => r.json());
    await mouse(page.getByRole('button', { name: '刷新', exact: true })); await page.getByText('排行榜暂时连不上，显示本机成绩', { exact: true }).waitFor();
    assert.match(await text(), /本机/); assert.match(await text(), /3321/); await page.screenshot({ path: path.join(SHOTS, '08-backend-stopped-local.png') });
    assert.deepEqual(errors, []);
    const result = { ok: true, mouse: 'CDP Input.dispatchMouseEvent', uploads: status.uploads - before.uploads, custom: 3321, realChallenge: 'feeder/m1/l4', packBootModes: [1, 2, 3, 4], languages: ['zh-Hant', 'en', 'zh-Hans'], backendStopped: true, errors, screenshots: fs.readdirSync(SHOTS).filter(x => x.endsWith('.png')) };
    fs.writeFileSync(path.join(SHOTS, 'browser-check.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
