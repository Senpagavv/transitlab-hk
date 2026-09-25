// Visual smoke check of the running dev site, using the Microsoft Edge already installed on Windows.
// Records console errors and failed requests, and saves screenshots at several zoom levels,
// including right after a fast mouse-wheel zoom.
//
// Usage (dev servers must be running):  node scripts/check-map.mjs <output-dir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const SITE = 'http://localhost:5173/'
const outDir = process.argv[2] ?? 'map-check'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
page.on('requestfailed', (r) => problems.push(`failed: ${r.failure()?.errorText} ${r.url()}`))
page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`))

async function shot(name) {
  await page.screenshot({ path: join(outDir, `${name}.png`) })
}

async function view(name, hash, waitMs = 8000) {
  await page.goto(`${SITE}#${hash}`)
  await page.waitForTimeout(waitMs)
  await shot(name)
}

await view('1-overview-z10', '10.3/22.36/114.12')
await view('2-kowloon-z14', '14/22.3193/114.1694')
await view('3-mongkok-z17', '17/22.3193/114.1694')

// Fast wheel zoom towards Mong Kok, like a quick scroll with the mouse.
for (const startZoom of [12, 10]) {
  await view(`4-z${startZoom}-before-fast-zoom`, `${startZoom}/22.3193/114.1694`, 6000)
  await page.mouse.move(640, 440)
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -250)
    await page.waitForTimeout(40)
  }
  await page.waitForTimeout(300)
  await shot(`5-z${startZoom}-fast-zoom-after-0.3s`)
  await page.waitForTimeout(1200)
  await shot(`6-z${startZoom}-fast-zoom-after-1.5s`)
}

const finalHash = await page.evaluate(() => location.hash)
writeFileSync(join(outDir, 'report.txt'), [`final view: ${finalHash}`, ...problems].join('\n'))
console.log(`final view: ${finalHash}`)
console.log(problems.length ? problems.slice(0, 30).join('\n') : 'no console errors or failed requests')
await browser.close()
