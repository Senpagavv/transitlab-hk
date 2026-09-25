// Visual check of the zone layer: the overview, a zone's data card, and the population-change view.
// Records console errors and failed requests alongside the screenshots.
//
// Usage (dev servers must be running):  node scripts/check-zones.mjs <output-dir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const SITE = 'http://localhost:5173/'
const outDir = process.argv[2] ?? 'map-check/zones'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
page.on('requestfailed', (r) => problems.push(`failed: ${r.failure()?.errorText} ${r.url()}`))
page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`))

const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) })

// Whole territory: density, the default metric.
await page.goto(`${SITE}#10.4/22.36/114.12`)
await page.waitForTimeout(9000)
await shot('1-density-overview')

// Sha Tin at street scale, then click the middle of the map to open that zone's card.
await page.goto(`${SITE}#13.2/22.3823/114.1886`)
await page.waitForTimeout(7000)
const map = await page.locator('.map-area').boundingBox()
await page.mouse.click(map.x + map.width / 2, map.y + map.height / 2)
await page.waitForTimeout(1500)
await shot('2-zone-card')
const card = await page.locator('.zone-panel h2').textContent().catch(() => null)

// Population change 2021 -> 2026: Kai Tak and the northern new towns should stand out.
await page.selectOption('#zone-metric', 'growth')
await page.goto(`${SITE}#10.9/22.40/114.12`)
await page.waitForTimeout(8000)
await page.selectOption('#zone-metric', 'growth')
await page.waitForTimeout(1500)
await shot('3-growth')

writeFileSync(join(outDir, 'report.txt'), [`card: ${card}`, ...problems].join('\n'))
console.log(`zone card opened: ${card ?? 'none'}`)
console.log(problems.length ? problems.slice(0, 30).join('\n') : 'no console errors or failed requests')
await browser.close()
