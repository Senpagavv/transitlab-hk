// 截图检查 game-demo（双击打开的本地文件，不需要服务器）。
// 用法（frontend 目录）：node scripts/check-bridge-demo.mjs map-check/bridge（别输出到 game-demo 里，会被一起上传）
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? 'bridge-check'
// 经纬度 -> 屏幕像素（两页默认视图：setView 22.35, 114.13，缩放 11；视图比 maxBounds 宽，Leaflet 会把经度中心挪到边界正中 114.125）
const HARBOUR = [114.150, 22.297]            // 上环与西九之间的维港，300 米内都是水
const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))
async function px(page, lon, lat, c = [114.125, 22.35], z = 11) {
  const r = await page.evaluate(() => { const b = document.getElementById('map').getBoundingClientRect(); return [b.left, b.top, b.width, b.height] })
  const W = 256 * 2 ** z
  return [r[0] + r[2] / 2 + (lon - c[0]) / 360 * W, r[1] + r[3] / 2 - (merc(lat) - merc(c[1])) / (2 * Math.PI) * W]
}
mkdirSync(outDir, { recursive: true })
const url = pathToFileURL(resolve('../game-demo/index.html')).href
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const problems = []
for (const [label, vp] of [['desktop', { width: 1366, height: 820 }], ['phone', { width: 400, height: 820 }]]) {
  const page = await browser.newPage({ viewport: vp })
  page.on('console', m => m.type() === 'error' && problems.push(`${label} console: ${m.text()}`))
  page.on('pageerror', e => problems.push(`${label} pageerror: ${e.message}`))
  page.on('requestfailed', r => problems.push(`${label} failed: ${r.failure()?.errorText} ${r.url()}`))
  await page.goto(url)
  await page.waitForTimeout(5000)
  await page.screenshot({ path: join(outDir, `${label}-1-start.png`) })
  // 点地图两下修一座桥
  if (label === 'desktop') {
    // 先点海上（默认视图下才算得准像素）：不能放桥头，要提示
    await page.mouse.click(...await px(page, ...HARBOUR))
    await page.waitForTimeout(500)
    const step = await page.textContent('#step'), dots = await page.locator('.end-dot').count()
    if (!step.includes('海') || dots) problems.push(`bridge water click: step「${step}」, ${dots} 个桥头`)
    await page.screenshot({ path: join(outDir, `${label}-1b-water-click.png`) })
    await page.mouse.click(760, 420)
    await page.mouse.move(900, 330)
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(outDir, `${label}-2-placing.png`) })
    await page.mouse.click(900, 330)
    await page.waitForTimeout(3500)
    await page.screenshot({ path: join(outDir, `${label}-3-clicked.png`) })
    await page.click('#reset')
  }
  await page.click('#examples button:nth-of-type(1)')
  await page.waitForTimeout(4000)
  await page.screenshot({ path: join(outDir, `${label}-4-example.png`) })
  await page.close()
}
// 地铁页：双击按住画一条弯线 -> 开始算 -> 看一轮轮变化；再看例子
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 820 } })
  page.on('console', m => m.type() === 'error' && problems.push(`metro console: ${m.text()}`))
  page.on('pageerror', e => problems.push(`metro pageerror: ${e.message}`))
  page.on('requestfailed', r => problems.push(`metro failed: ${r.failure()?.errorText} ${r.url()}`))
  await page.goto(pathToFileURL(resolve('../game-demo/metro.html')).href)
  await page.waitForTimeout(5000)
  await page.screenshot({ path: join(outDir, 'metro-1-start.png') })
  // 放大到九龙东再画
  await page.evaluate(() => document.querySelector('.leaflet-control-zoom-in').click())
  await page.waitForTimeout(800)
  await page.evaluate(() => document.querySelector('.leaflet-control-zoom-in').click())
  await page.waitForTimeout(2500)
  const pts = [[760, 250], [800, 300], [850, 330], [900, 380], [930, 450], [950, 520]]
  await page.mouse.move(...pts[0]); await page.mouse.down(); await page.mouse.up()
  await page.mouse.down()
  for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(outDir, 'metro-2-drawn.png') })
  await page.click('#go')
  await page.waitForTimeout(6000)
  await page.screenshot({ path: join(outDir, 'metro-3-running.png') })
  await page.waitForFunction(() => document.querySelector('#progTitle')?.textContent.startsWith('算完了'), null, { timeout: 120000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(outDir, 'metro-4-done.png') })
  await page.check('input[value="dens1"]')
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(outDir, 'metro-5-density-after.png') })
  await page.close()
}
// 地铁页：从维港中间画到九龙塘一带，线头要收回岸上（终点留足余量：像素差几格也还在陆地上、收回后仍长于 0.8 公里）
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 820 } })
  page.on('pageerror', e => problems.push(`metro-water pageerror: ${e.message}`))
  await page.goto(pathToFileURL(resolve('../game-demo/metro.html')).href)
  await page.waitForTimeout(4000)
  const a = await px(page, ...HARBOUR), b = await px(page, 114.178, 22.338)
  await page.mouse.move(...a); await page.mouse.down(); await page.mouse.up()
  await page.mouse.down()
  await page.mouse.move(...b, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  const step = await page.textContent('#step'), wet = await page.textContent('#wetNote')
  if (!step.includes('线头伸到了海里') || wet) problems.push(`metro water start: step「${step}」 wetNote「${wet}」`)
  await page.screenshot({ path: join(outDir, 'metro-6-water-start.png') })
  await page.close()
}
await browser.close()
console.log(problems.length ? problems.join('\n') : 'no console errors / failed requests')
