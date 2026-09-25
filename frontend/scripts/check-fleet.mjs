// Visual check of the fleet sandbox: the panel, a smaller fleet picked on the curve, and the two
// new zone metrics. Records console errors and failed requests alongside the screenshots.
//
// Usage (dev servers must be running):  node scripts/check-fleet.mjs <output-dir>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const SITE = 'http://localhost:5173/'
const outDir = process.argv[2] ?? 'map-check/fleet'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

const problems = []
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
// React unmounts its fetches on the strict-mode double render; those aborts are not faults.
page.on('requestfailed', (r) => {
  const why = r.failure()?.errorText ?? ''
  if (!why.includes('ERR_ABORTED')) problems.push(`failed: ${why} ${r.url()}`)
})
page.on('response', (r) => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url()}`))

const shot = async (name) => {
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(outDir, `${name}.png`) })
}

await page.goto(SITE, { waitUntil: 'networkidle' })
await page.waitForSelector('.fleet-panel', { timeout: 20000 })
await shot('01-panel')

// The panel must show the headline, not just the chart.
const headline = await page.locator('.fleet-headline').innerText().catch(() => '')
if (!/最小车队/.test(headline)) problems.push('面板没有显示最小车队结论')

// Pick the smallest point on the curve and check the figures move.
const before = await page.locator('.fleet-figures').innerText()
const dots = page.locator('.fleet-dot-hit')
await dots.first().click()
await page.waitForTimeout(400)
const after = await page.locator('.fleet-figures').innerText()
if (before === after) problems.push('点击曲线圆点后数字没有变化')
await shot('02-small-fleet')

// Open the limits, which must be visible rather than buried in a document.
await page.locator('.fleet-limits summary').click()
await shot('03-limits')

// The two new zone metrics must be pickable and must paint the map.
const layer = page.locator('.zone-legend input[type="checkbox"]').first()
if (await layer.count()) await layer.check().catch(() => {})
await page.waitForTimeout(800)
const picker = page.locator('select.zone-metric')
for (const id of ['taxi_demand', 'service_small']) {
  const has = await picker.locator(`option[value="${id}"]`).count()
  if (!has) { problems.push(`分区图层缺少指标 ${id}`); continue }
  await picker.selectOption(id)
  await shot(`0${id === 'taxi_demand' ? 4 : 5}-${id}`)
}

writeFileSync(join(outDir, 'problems.txt'), problems.join('\n') || '无', 'utf8')
console.log(problems.length ? `问题 ${problems.length} 项:\n${problems.join('\n')}` : '无控制台错误、无失败请求')
console.log(`截图 -> ${outDir}`)
await browser.close()
