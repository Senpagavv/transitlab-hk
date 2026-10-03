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
const mid = (name) => page.evaluate((name) => { const S = window.TLA.S; const i = S.edges.findIndex((e) => e.name === name); const g = S.edges[i].geom; const p = g[Math.floor(g.length / 2)]; const q = window.TLA.map.latLngToContainerPoint(p); const r = document.getElementById('map').getBoundingClientRect(); return [r.left + q.x, r.top + q.y] }, name)
await page.goto(process.argv[3] ?? 'http://127.0.0.1:8000/game/alien/')
await page.waitForTimeout(1500)
await shot('01-intro')
await page.click('#introOk')
await page.click('[data-speed="4"]')
await page.click('#play')
await page.waitForTimeout(5000)
await page.click('#play')   // pause
let [x, y] = await mid('龙翔道'); await page.mouse.move(x, y); await page.waitForTimeout(1500)
await shot('02-preview-longcheung')
console.log((await page.textContent('#card')).replace(/\s+/g, ' ').slice(0, 400))
await page.mouse.click(x, y); await page.waitForTimeout(500);
[x, y] = await mid('太子道东'); await page.mouse.move(x, y); await page.waitForTimeout(1500)
await shot('03-preview-prince')
await page.mouse.click(x, y); await page.mouse.move(5, 880)
await page.click('#play')
await page.waitForTimeout(12000)
await shot('04-mid')
await page.waitForSelector('#end:not([hidden])', { timeout: 120000 })
await page.waitForTimeout(800)
await shot('05-end')
console.log(await page.evaluate(() => JSON.stringify(window.TLA.S.summary())))
console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'no page errors')
await browser.close()
