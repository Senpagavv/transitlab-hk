// The search marker: one marker at the latest place searched - none left at earlier ones - and none
// once the search box is cleared (the × button) or emptied by deleting the text.
// Usage (dev servers must be running):  node scripts/check-search-marker.mjs <output-dir>
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? 'map-check/search'
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto('http://localhost:5173/')
await page.waitForTimeout(6000)
for (const box of await page.locator('.map-area input[type=checkbox]').all()) await box.uncheck() // red traffic lines would count

async function search(text) {
  await page.locator('.search-input input').fill(text)
  await page.waitForSelector('#search-listbox li', { timeout: 10000 })
  await page.locator('#search-listbox li').first().click()
  await page.waitForTimeout(3000)
}

// Marker dots on the screen: pixels of the marker's red, grouped into blobs 30 px apart.
async function markers(name) {
  await page.screenshot({ path: join(outDir, `${name}.png`) })
  return page.evaluate(async (src) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, img.width, img.height)
    const blobs = []
    for (let y = 70; y < img.height; y += 2) {
      for (let x = 0; x < img.width; x += 2) {
        const i = (y * img.width + x) * 4
        const red = Math.abs(data[i] - 230) < 20 && Math.abs(data[i + 1] - 80) < 25 && Math.abs(data[i + 2] - 40) < 25
        if (red && !blobs.some(([bx, by]) => Math.hypot(bx - x, by - y) < 30)) blobs.push([x, y])
      }
    }
    return blobs.length
  }, `data:image/png;base64,${(await page.screenshot()).toString('base64')}`)
}

await search('沙田站')
await search('中环站')
await search('屯门站')
await page.evaluate(() => window.__map.jumpTo({ center: [114.13, 22.37], zoom: 10 }))
await page.waitForTimeout(2500)
const afterThree = await markers('1-three-searches-whole-hk')
await page.locator('.search-clear').click()
await page.waitForTimeout(1000)
const afterClear = await markers('2-after-clear')
await search('中环站')
await page.locator('.search-input input').fill('')
await page.waitForTimeout(1000)
const afterDelete = await markers('3-after-deleting-text')
const listOpen = await page.locator('.search-dropdown.open').count()

console.log(`markers after three searches: ${afterThree} (want 1)`)
console.log(`markers after the × button: ${afterClear} (want 0)`)
console.log(`markers after deleting the text: ${afterDelete} (want 0)`)
console.log(listOpen ? 'FAIL: result list open after clearing' : 'ok: result list closed after clearing')
await browser.close()
