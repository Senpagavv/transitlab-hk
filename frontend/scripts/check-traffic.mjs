// Visual check of the live traffic lines: the territory, a close-up where both directions of a
// street share its centreline, and the layer switched off (every line and dot must go).
// Records console errors and failed requests alongside the screenshots.
//
// Usage (dev servers must be running):  node scripts/check-traffic.mjs <output-dir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const SITE = 'http://localhost:5173/'
const outDir = process.argv[2] ?? 'map-check/traffic'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`))

const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) })
const zoneBox = () => page.locator('.zone-legend input[type=checkbox]')
const trafficBox = () => page.locator('.traffic-legend input[type=checkbox]')

// Zones off, so the lines are judged on the plain basemap first.
await page.goto(`${SITE}#11.3/22.36/114.15`)
await page.waitForTimeout(9000)
await zoneBox().uncheck()
await page.waitForTimeout(1500)
await shot('1-territory')

// Kowloon at street scale: Nathan Road-type two-way streets and the dual carriageways around them.
await page.goto(`${SITE}#14.2/22.3185/114.1700`)
await page.waitForTimeout(7000)
await shot('2-kowloon-close')

// Tolo Highway / Sha Tin: long continuous lines through several detectors.
await page.goto(`${SITE}#12.6/22.40/114.20`)
await page.waitForTimeout(7000)
await shot('3-sha-tin')

// With the zones back on, then with the traffic layer switched off.
await zoneBox().check()
await page.waitForTimeout(2500)
await shot('4-with-zones')
await trafficBox().uncheck()
await page.waitForTimeout(1500)
await shot('5-traffic-off')

writeFileSync(join(outDir, 'report.txt'), problems.join('\n'))
console.log(problems.length ? problems.slice(0, 30).join('\n') : 'no console errors or failed requests')
await browser.close()
