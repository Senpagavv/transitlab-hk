// Visual and interaction check for the area deployment panel.
// Usage (dev servers must be running): node scripts/check-deployment.mjs <output-dir>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const SITE = 'http://localhost:5173/'
const outDir = process.argv[2]
if (!outDir) throw new Error('Provide an output directory for screenshots')
mkdirSync(outDir, { recursive: true })

const dataPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/web/deployment-scenarios.json')
const source = JSON.parse(readFileSync(dataPath, 'utf8'))
const expectedLimits = source.limits.length
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const problems = []
const shots = []

// An alternate backend port is useful when another task already owns port 8000.
if (process.env.DEPLOYMENT_API_URL) {
  await page.route('**/api/fleet/deployment', async (route) => {
    const response = await route.fetch({ url: process.env.DEPLOYMENT_API_URL })
    await route.fulfill({ response })
  })
}

page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('ERR_ABORTED')) {
    problems.push(`console: ${message.text()}`)
  }
})
page.on('requestfailed', (request) => {
  const reason = request.failure()?.errorText ?? ''
  if (!reason.includes('ERR_ABORTED')) problems.push(`failed: ${reason} ${request.url()}`)
})
page.on('response', (response) => {
  if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`)
})

const shot = async (name) => {
  const path = resolve(join(outDir, `${name}.png`))
  await page.screenshot({ path })
  shots.push(path)
}
const metrics = () => page.locator('.deploy-metric strong').allInnerTexts()
const changed = (before, after, action) => {
  if (before.length !== 4 || after.length !== 4) {
    problems.push(`${action}时四个数字没有全部显示`)
    return
  }
  before.forEach((value, index) => {
    if (value === after[index]) problems.push(`${action}后第 ${index + 1} 个数字没有变化`)
  })
}
const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
  a.y < b.y + b.height && a.y + a.height > b.y
const axisMaxima = () => Promise.all([
  page.locator('.deploy-axis-served-max').innerText(),
  page.locator('.deploy-axis-busy-max').innerText(),
])
const checkThroughput = async (context) => {
  const note = await page.locator('.deploy-chart-throughput').innerText()
  const match = note.match(/每辆车每小时接走\s+([\d.]+)\s+单/)
  const value = match ? Number(match[1]) : NaN
  if (!Number.isFinite(value) || value <= 0) {
    problems.push(`${context}的每辆车每小时接走数不是有限正数：${note}`)
  }
}

try {
  await page.goto(SITE, { waitUntil: 'networkidle' })
  await page.waitForSelector('.deploy-panel', { timeout: 20000 })
  if (await page.locator('.deploy-toggle').getAttribute('aria-expanded') !== 'false') {
    problems.push('面板没有默认折叠')
  }
  await shot('01-collapsed')

  await page.locator('.deploy-toggle').click()
  await page.locator('.deploy-metrics').waitFor()
  await shot('02-expanded')
  const servedTop = page.locator('.deploy-axis-served-max')
  const busyTop = page.locator('.deploy-axis-busy-max')
  const servedZero = page.locator('.deploy-axis-served-zero')
  const busyZero = page.locator('.deploy-axis-busy-zero')
  if (await servedTop.count() !== 1 || await busyTop.count() !== 1 ||
      await servedZero.count() !== 1 || await busyZero.count() !== 1 ||
      await servedZero.innerText() !== '0' || await busyZero.innerText() !== '0') {
    problems.push('双轴没有各自显示最大值和 0 刻度')
  } else {
    const [served, busy] = await axisMaxima()
    const initialKind = source.kinds[0]
    const initialArea = source.areas.find((area) =>
      source.scenarios.some((scenario) => scenario.kind === initialKind && scenario.area === area))
    const initialScenarios = source.scenarios.filter((scenario) =>
      scenario.kind === initialKind && scenario.area === initialArea)
    const initialScenario = initialScenarios.find((scenario) => scenario.av_fleet ===
      Math.max(...initialScenarios.map((scenario) => scenario.av_fleet)))
    const peaks = [Math.max(...initialScenario.hourly.map((row) => row.served_av)),
      Math.max(...initialScenario.hourly.map((row) => row.av_busy))]
    if (peaks[0] === peaks[1]) {
      console.log(`双轴最大值恰好相同（${peaks[0]}），跳过不同值比较`)
    } else if (served === busy) {
      problems.push(`双轴最大值文字相同：${served}`)
    }
  }
  await checkThroughput('默认情景')
  const kindButtons = page.locator('.deploy-picker[aria-label="情景类型"] button')
  const kindCount = new Set(source.scenarios.map((scenario) => scenario.kind)).size
  if (await kindButtons.count() !== kindCount) {
    problems.push(`情景类型组数不符：页面 ${await kindButtons.count()}，JSON ${kindCount}`)
  }
  const panelBox = await page.locator('.deploy-panel').boundingBox()
  const legends = page.locator('.map-legends .map-legend')
  const legendCount = await legends.count()
  if (legendCount < 2) problems.push(`只找到 ${legendCount} 个地图图例`)
  for (let index = 0; index < legendCount; index++) {
    const legendBox = await legends.nth(index).boundingBox()
    if (panelBox && legendBox && intersects(panelBox, legendBox)) {
      problems.push(`展开面板遮挡第 ${index + 1} 个地图图例`)
    }
  }

  const beforeArea = await metrics()
  const areaButtons = page.locator('.deploy-picker[aria-label="投放区域"] button')
  if (await areaButtons.count() < 2) {
    problems.push('没有可切换的第二个区域')
  } else {
    await areaButtons.nth(1).click()
    await page.waitForFunction((before) =>
      [...document.querySelectorAll('.deploy-metric strong')].map((node) => node.textContent).join('|') !== before,
      beforeArea.join('|'))
    changed(beforeArea, await metrics(), '切换区域')
    await shot('03-other-area')
  }

  const beforeFleet = await metrics()
  const beforeFleetAxes = await axisMaxima()
  const fleetButtons = page.locator('.deploy-picker[aria-label="无人车车队规模"] button')
  if (await fleetButtons.count() < 2) {
    problems.push('没有可切换的第二个车队规模')
  } else {
    await fleetButtons.first().click()
    await page.waitForFunction((before) =>
      [...document.querySelectorAll('.deploy-metric strong')].map((node) => node.textContent).join('|') !== before,
      beforeFleet.join('|'))
    changed(beforeFleet, await metrics(), '切换车队规模')
    const afterFleetAxes = await axisMaxima()
    if (beforeFleetAxes[0] === afterFleetAxes[0] || beforeFleetAxes[1] === afterFleetAxes[1]) {
      problems.push(`切换车队规模后双轴最大值未全部变化：${beforeFleetAxes.join('/')} → ${afterFleetAxes.join('/')}`)
    }
    await shot('04-other-fleet')
  }

  await page.locator('.deploy-limits summary').click()
  const limits = page.locator('.deploy-limits li')
  if (await limits.count() !== expectedLimits) {
    problems.push(`局限条目数不符：页面 ${await limits.count()}，JSON ${expectedLimits}`)
  }
  await limits.last().scrollIntoViewIfNeeded()
  await shot('05-limits')

  // Night-only service has a zero daytime segment, but still needs a readable chart.
  await kindButtons.filter({ hasText: '时段投放' }).click()
  await checkThroughput('时段投放情景')
  await page.locator('.deploy-chart').scrollIntoViewIfNeeded()
  await shot('07-time-window')

  // A zero-fleet baseline must show a defined message instead of a divided-by-zero value.
  await kindButtons.filter({ hasText: '区域投放' }).click()
  await page.locator('.deploy-picker[aria-label="无人车车队规模"] button').first().click()
  const baselineFleet = await page.locator('.deploy-picker[aria-label="无人车车队规模"] button[aria-pressed="true"]').innerText()
  if (!baselineFleet.includes('0 · 基准')) problems.push(`未选中零车队基准情景：${baselineFleet}`)
  const baselineText = await page.locator('body').innerText()
  if (/NaN|Infinity/.test(baselineText)) problems.push('零车队基准情景出现 NaN 或 Infinity')
  await page.locator('.deploy-chart').scrollIntoViewIfNeeded()
  await shot('08-zero-fleet-baseline')

  // A future kind must be selectable without adding a new frontend case.
  const futureKind = 'future_kind'
  const futureData = {
    ...source,
    kinds: [...source.kinds, futureKind],
    scenarios: [...source.scenarios, { ...source.scenarios[0], kind: futureKind }],
  }
  await page.unroute('**/api/fleet/deployment')
  await page.route('**/api/fleet/deployment', (route) => route.fulfill({ json: futureData }))
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.deploy-toggle').click()
  const futureButton = page.locator('.deploy-picker[aria-label="情景类型"] button').filter({ hasText: futureKind })
  if (await futureButton.count() !== 1) {
    problems.push('未知 kind 没有作为独立情景组显示')
  } else {
    await futureButton.click()
    if (await futureButton.getAttribute('aria-pressed') !== 'true' || await metrics().then((values) => values.length) !== 4) {
      problems.push('未知 kind 无法显示情景数字')
    }
    await shot('06-future-kind')
  }
} finally {
  writeFileSync(join(outDir, 'problems.txt'), problems.join('\n') || '无', 'utf8')
  console.log(problems.length ? `问题 ${problems.length} 项:\n${problems.join('\n')}` : '无控制台错误、无失败请求；交互检查通过')
  console.log(`截图 ->\n${shots.join('\n')}`)
  await browser.close()
  if (problems.length) process.exitCode = 1
}
