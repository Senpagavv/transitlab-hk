// 截图检查「外星人降临启德」demo（后端在 8000 端口）：node scripts/check-alien.mjs map-check/alien
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
const out = process.argv[2] ?? 'map-check/alien'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
const problems = []
page.on('pageerror', (e) => problems.push('page error: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()) })
const shot = async (n) => { await page.screenshot({ path: join(out, n + '.png') }); console.log('shot', n) }
const at = (lat, lon) => page.evaluate(([lat, lon]) => { const p = window.TLA.map.latLngToContainerPoint([lat, lon]); const r = document.getElementById('map').getBoundingClientRect(); return [r.left + p.x, r.top + p.y] }, [lat, lon])
await page.goto(process.argv[3] ?? 'http://127.0.0.1:8000/game/alien/')
await page.waitForTimeout(1500)
await shot('01-intro')
await page.click('#introOk')
await page.click('[data-speed="4"]')
await page.click('#play')
await page.waitForTimeout(6000)
await shot('02-early')
// place two pickups and a bus lane
await page.click('#toolPickup')
let [x, y] = await at(22.383, 114.189); await page.mouse.click(x, y); await page.waitForTimeout(400)
await shot('03-preview')
await page.click('#pvOk')
await page.click('#toolPickup');
[x, y] = await at(22.392, 113.976); await page.mouse.click(x, y); await page.waitForTimeout(300); await page.click('#pvOk')
await page.click('#toolLane');
[x, y] = await at(22.331, 114.197); await page.mouse.click(x, y); await page.waitForTimeout(300)
await page.click('#play')
await page.waitForTimeout(15000)
await shot('04-mid')
for (let i = 0; i < 12; i++) {   // keep playing through auto-pauses until the end
  if (await page.isVisible('#end')) break
  const label = await page.textContent('#play')
  if (!label.includes('暂停')) await page.click('#play')
  await page.waitForTimeout(6000)
}
await page.waitForTimeout(1000)
await shot('05-end')
console.log(await page.evaluate(() => JSON.stringify(window.TLA.S.summary())))
console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'no page errors')
await browser.close()
