// Hover a live traffic line and screenshot the tooltip: it should list each lane's speed and flow.
// Usage (dev servers must be running):  node scripts/check-traffic-tooltip.mjs <output-dir>
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? 'map-check/traffic'
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

// Tolo Highway beside Sha Tin racecourse, close enough for the lines to be easy to hit.
await page.goto('http://localhost:5173/#15.2/22.4010/114.2040')
await page.waitForTimeout(9000)
await page.locator('.zone-legend input[type=checkbox]').uncheck()
await page.waitForTimeout(1500)

// Sweep across the screen until the pointer lands on a line and the tooltip appears.
const box = await page.locator('.map-area').boundingBox()
let found = false
for (let y = box.y + 150; y < box.y + box.height - 150 && !found; y += 6) {
  for (let x = box.x + 200; x < box.x + box.width - 300 && !found; x += 12) {
    await page.mouse.move(x, y)
    found = await page.locator('.deck-tooltip').evaluate((el) => el.style.display !== 'none' && el.innerText.length > 0).catch(() => false)
  }
}
await page.waitForTimeout(300)
await page.screenshot({ path: join(outDir, 'tooltip.png') })
console.log(found ? 'tooltip: ' + (await page.locator('.deck-tooltip').innerText()).replace(/\n/g, ' | ') : 'no tooltip found')
await browser.close()
