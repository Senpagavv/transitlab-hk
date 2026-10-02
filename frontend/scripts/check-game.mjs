// 截图检查 /game 的可玩 demo v2（需要先启动后端：uv run uvicorn backend.main:app --port 8010）。
// 用法（frontend 目录）：node scripts/check-game.mjs map-check/game [http://127.0.0.1:8010]
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? 'map-check/game'
const base = (process.argv[3] ?? 'http://127.0.0.1:8010') + '/game/'
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
const problems = []
page.on('pageerror', (e) => problems.push('page error: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()) })
const shot = async (name) => { await page.screenshot({ path: join(outDir, name + '.png') }); console.log('shot', name) }
const at = (lat, lon) => page.evaluate(([lat, lon]) => { const p = window.TL.map.latLngToContainerPoint([lat, lon]); const r = document.getElementById('map').getBoundingClientRect(); return [r.left + p.x, r.top + p.y] }, [lat, lon])
const clickAt = async (lat, lon, wait = 900) => { const [x, y] = await at(lat, lon); await page.mouse.click(x, y); await page.waitForTimeout(wait) }
const run = async (name) => {
  await page.click('#go')
  await page.waitForSelector('#results:not([hidden])', { timeout: 300000 })
  await page.waitForTimeout(1500)
  await shot(name)
  console.log(name, (await page.$eval('#results', (e) => e.innerText)).slice(0, 700).replace(/\n+/g, ' | '))
}

await page.goto(base)
await page.evaluate(() => localStorage.clear())
await page.goto(base)
await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 })
await page.waitForTimeout(1000)
await shot('01-home')

// commute mission: Tuen Mun -> Yau Tsim Mong, an express line
await page.click('[data-m="c-7-9"]')
await page.waitForTimeout(2500)
await shot('02-mission')
await page.click('.chip[data-layer="flows"]')
await page.waitForTimeout(500)
await page.click('#newLine')
await clickAt(22.3950, 113.9730)
await clickAt(22.3700, 114.0300)
await shot('03-two-stations')
await clickAt(22.3580, 114.1070)
await clickAt(22.3040, 114.1610, 300)
await page.waitForTimeout(400)
await shot('04-combo')
await clickAt(22.3050, 114.1710)
await page.click('.ldone')
await page.waitForTimeout(1500)
await shot('05-drawn')
await run('06-result-commute')

// beat the government: Northern Link
await page.click('#home')
await page.waitForTimeout(800)
await page.click('[data-m="g-NOL"]')
await page.waitForTimeout(2500)
await page.click('#newLine')
for (const [lat, lon] of [[22.4347, 114.0632], [22.4600, 114.0450], [22.4960, 114.0860], [22.5050, 114.1050], [22.5014, 114.1279]]) await clickAt(lat, lon)
await page.click('.ldone')
await page.waitForTimeout(1500)
await shot('07-gov-drawn')
await run('08-result-gov')

console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'no page errors')
await browser.close()
