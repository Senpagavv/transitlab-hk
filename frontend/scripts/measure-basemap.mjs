// Measures how quickly the map is ready after the camera stops: every tile for the new view loaded
// (and still loaded 100 ms later), for a fast zoom and a drag. Fresh browser context each run.
// "tiles" = cache (through the backend's disk cache) or direct (government server).
//
// Usage (dev servers running):  node scripts/measure-basemap.mjs <cache|direct> [zoom/lat/lon]
import { chromium } from 'playwright'

const [tiles = 'cache', view = '12/22.3193/114.1694'] = process.argv.slice(2)
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()

async function readyAfter(action) {
  await page.evaluate(() => {
    const map = window.__map
    const log = (window.__ready = { moveend: null, ready: null })
    map.once('moveend', () => (log.moveend = performance.now()))
    let since = 0
    const poll = () => {
      const now = performance.now()
      const ok = log.moveend !== null && !map.isMoving() && map.areTilesLoaded() && now - log.moveend >= 100
      since = ok ? since || now : 0
      if (since && now - since >= 100) log.ready = since
      else requestAnimationFrame(poll)
    }
    requestAnimationFrame(poll)
  })
  await action()
  await page.waitForFunction(() => window.__ready.ready !== null, null, { timeout: 30000, polling: 50 })
  return page.evaluate(() => Math.round(window.__ready.ready - window.__ready.moveend))
}

await page.goto(`http://localhost:5173/?veil=off&tiles=${tiles}#${view}`)
await page.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded(), null, { timeout: 60000 })
await page.waitForTimeout(1500)

const zoomMs = await readyAfter(async () => {
  await page.mouse.move(640, 430)
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -250)
    await page.waitForTimeout(40)
  }
})
await page.waitForTimeout(1500)
const dragMs = await readyAfter(async () => {
  await page.mouse.move(1000, 430)
  await page.mouse.down()
  await page.mouse.move(250, 430, { steps: 12 })
  await page.mouse.up()
})

console.log(JSON.stringify({ tiles, view, readyAfterZoomMs: zoomMs, readyAfterDragMs: dragMs }))
await browser.close()
