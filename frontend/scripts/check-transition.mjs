// Checks the loading transition in the installed Microsoft Edge (headless): takes timed screenshots
// after a fast wheel zoom and a fast drag, and measures frame rate, with the veil on and off.
// Each mode runs in a fresh browser context (empty tile cache).
//
// Usage (dev servers must be running):  node scripts/check-transition.mjs <output-dir>
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const outDir = process.argv[2] ?? 'map-check'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })

function frameStats(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b)
  const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length
  return {
    frames: intervals.length,
    avgFps: Math.round(1000 / avg),
    p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)]),
    worstFrameMs: Math.round(sorted.at(-1)),
  }
}

async function startFrameCounter(page) {
  await page.evaluate(() => {
    window.__frames = []
    let last = performance.now()
    const tick = (t) => {
      window.__frames.push(t - last)
      last = t
      if (!window.__stopFrames) requestAnimationFrame(tick)
    }
    window.__stopFrames = false
    requestAnimationFrame(tick)
  })
}

async function stopFrameCounter(page) {
  return page.evaluate(() => {
    window.__stopFrames = true
    return window.__frames.slice(1)
  })
}

// Alternate on/off twice: frame timings in a headless browser are noisy.
for (const [round, mode] of [[1, 'on'], [1, 'off'], [2, 'on'], [2, 'off']]) {
  const shoot = round === 1
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  // Pass "direct" as the second argument to bypass the local tile cache (slowest case).
  const tiles = process.argv[3] === 'direct' ? '&tiles=direct' : ''
  await page.goto(`http://localhost:5173/?veil=${mode}${tiles}#12/22.3193/114.1694`)
  await page.waitForTimeout(7000)

  // --- fast wheel zoom -------------------------------------------------------------------
  await startFrameCounter(page)
  await page.mouse.move(640, 430)
  for (let i = 0; i < 12; i++) {
    await page.mouse.wheel(0, -250)
    await page.waitForTimeout(40)
  }
  const zoomShots = [150, 400, 800, 1300, 2000, 3000]
  let elapsed = 0
  for (const at of zoomShots) {
    await page.waitForTimeout(at - elapsed)
    elapsed = at
    if (shoot) await page.screenshot({ path: join(outDir, `${mode}-zoom-${String(at).padStart(4, '0')}ms.png`) })
    if (shoot && mode === 'on') console.log(`  zoom ${at}ms veil:`, JSON.stringify(await page.evaluate(() => window.__veil?.debugStats())))
  }
  const zoomFrames = await stopFrameCounter(page)
  await page.waitForTimeout(3000)

  // --- fast drag into a new area ------------------------------------------------------------
  await startFrameCounter(page)
  await page.mouse.move(1000, 430)
  await page.mouse.down()
  await page.mouse.move(250, 430, { steps: 12 })
  await page.mouse.up()
  const panShots = [120, 400, 900, 1600, 2600]
  elapsed = 0
  for (const at of panShots) {
    await page.waitForTimeout(at - elapsed)
    elapsed = at
    if (shoot) await page.screenshot({ path: join(outDir, `${mode}-pan-${String(at).padStart(4, '0')}ms.png`) })
    if (shoot && mode === 'on') {
      const stats = await page.evaluate(() => window.__veil?.debugStats())
      console.log(`  pan ${at}ms veil:`, JSON.stringify(stats))
    }
  }
  const panFrames = await stopFrameCounter(page)

  const layers = await page.evaluate(() =>
    [...document.querySelector('.maplibregl-canvas-container').children].map(
      (el) => `${el.tagName.toLowerCase()}${el.className ? '.' + el.className : ''}${el.id ? '#' + el.id : ''}`,
    ),
  )
  console.log(`\n[round ${round} · veil ${mode}]`)
  console.log('  zoom frames:', JSON.stringify(frameStats(zoomFrames)))
  console.log('  pan frames: ', JSON.stringify(frameStats(panFrames)))
  console.log('  canvas container children:', layers.join(' | '))
  console.log('  console errors:', errors.length ? errors.slice(0, 5) : 'none')
  await context.close()
}

await browser.close()
