// 截图检查 /game 的可玩 demo（需要先启动后端：uv run uvicorn backend.main:app --port 8010）。
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

await page.goto(base)
await page.evaluate(() => localStorage.clear())
await page.goto(base)
await page.waitForSelector('#loading', { state: 'hidden', timeout: 90000 })
await page.waitForTimeout(1500)
await shot('01-start')
await page.click('#introOk')
await page.click('.chip[data-layer="flows"]')
await page.waitForTimeout(800)
await shot('01b-flows')
await page.click('.chip[data-layer="flows"]')

// a station card for any point
const [x1, y1] = await at(22.4459, 114.0353)          // Yuen Long town
await page.mouse.click(x1, y1)
await page.waitForSelector('.card.station .grade', { timeout: 10000 })
await shot('02-card')

// draw a line by clicking: Tuen Mun -> Siu Hong -> ... new stations
await page.click('#newLine')
for (const [lat, lon] of [[22.3920, 113.9730], [22.4120, 113.9800], [22.4300, 113.9950]]) {
  const [x, y] = await at(lat, lon); await page.mouse.click(x, y); await page.waitForTimeout(700)
}
await shot('03-drawing')
await page.click('.ldone')

// the worked example, then run
await page.click('#example')
await page.waitForTimeout(2500)
await page.click('#go')
await page.waitForSelector('#results:not([hidden])', { timeout: 240000 })
await page.waitForTimeout(1500)
await shot('04-result-free')
const resText = await page.$eval('#results', (e) => e.innerText.slice(0, 600))
console.log(resText)

// search
await page.fill('#q', '沙田')
await page.waitForTimeout(1200)
await shot('05-search')
await page.keyboard.press('Escape')

// scenario: the example only, then run and score
await page.click('.tabs button[data-mode="north"]')
await page.waitForTimeout(1000)
await page.click('#example')
await page.waitForTimeout(2500)
await page.click('#go')
await page.waitForSelector('#results:not([hidden])', { timeout: 300000 })
await page.waitForTimeout(1500)
await shot('06-result-scenario')
console.log(await page.$eval('.score', (e) => e.innerText))
await page.$eval('.panel', (e) => { e.scrollTop = 0 })
await shot('07-scenario-top')

console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'no page errors')
await browser.close()
