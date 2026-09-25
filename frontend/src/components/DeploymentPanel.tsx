import { useEffect, useState } from 'react'

interface HourRow {
  hour: number
  served_av: number
  av_busy: number
}

interface Scenario {
  kind: string
  area: string
  av_fleet: number
  summary: {
    av_share_in_area: number
    wait_in_area_min: number
    av_busy_peak: number
    av_outside_area_peak: number
  }
  vs_baseline: {
    wait_in_area_min: number
    total_vehicle_km_pct: number
  }
  hourly: HourRow[]
}

interface DeploymentData {
  areas: string[]
  kinds: string[]
  scenarios: Scenario[]
  limits: string[]
}

const number = (value: number) => value.toLocaleString('zh-CN')
const kindName = (kind: string) => ({
  deployment: '区域投放',
  time_window: '时段投放',
  quota_swap: '牌照替换',
}[kind] ?? kind)
const changeClass = (value: number) => value < 0 ? 'deploy-decrease' : value > 0 ? 'deploy-increase' : ''
const signed = (value: number, digits: number) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`

function HourChart({ rows }: { rows: HourRow[] }) {
  const width = 320
  const height = 142
  const plotTop = 18
  const plotBottom = 113
  const plotLeft = 36
  const plotRight = 276
  const ordered = [...rows].sort((a, b) => a.hour - b.hour)
  const peakServed = Math.max(0, ...ordered.map((row) => row.served_av))
  const peakBusy = Math.max(0, ...ordered.map((row) => row.av_busy))
  const servedTick = peakServed
  const busyTick = peakBusy
  const maxServed = Math.max(1, servedTick)
  const maxBusy = Math.max(1, busyTick)
  const activeHours = ordered.filter((row) => row.av_busy > 0)
  const busyVehicleHours = activeHours.reduce((sum, row) => sum + row.av_busy, 0)
  const servedDuringActiveHours = activeHours.reduce((sum, row) => sum + row.served_av, 0)
  const servedPerVehicleHour = busyVehicleHours > 0
    ? servedDuringActiveHours / busyVehicleHours : null
  const x = (hour: number) => plotLeft + hour / 23 * (plotRight - plotLeft)
  const y = (value: number, max: number) => plotBottom - value / max * (plotBottom - plotTop)
  const line = (key: 'served_av' | 'av_busy', max: number) => ordered
    .map((row, index) => `${index ? 'L' : 'M'}${x(row.hour).toFixed(1)},${y(row[key], max).toFixed(1)}`)
    .join(' ')

  return (
    <>
      <svg className="deploy-chart" viewBox={`0 0 ${width} ${height}`} role="img"
           aria-label="0 到 23 时无人车接走行程读左轴，单位单；在跑车辆读右轴，单位辆">
        {[0, 0.5, 1].map((fraction) => (
          <line key={fraction} x1={plotLeft} x2={plotRight}
                y1={y(fraction, 1)} y2={y(fraction, 1)} className="deploy-grid" />
        ))}
        <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom}
              className="deploy-axis-line-served" />
        <line x1={plotRight} x2={plotRight} y1={plotTop} y2={plotBottom}
              className="deploy-axis-line-busy" />
        <path d={line('served_av', maxServed)} className="deploy-chart-served" />
        <path d={line('av_busy', maxBusy)} className="deploy-chart-busy" />
        <foreignObject x={0} y={plotTop - 5} width={plotLeft - 5} height={14}>
          <span className="deploy-chart-tick deploy-chart-tick-left deploy-axis-served deploy-axis-served-max">
            {number(servedTick)}
          </span>
        </foreignObject>
        <foreignObject x={0} y={plotBottom - 5} width={plotLeft - 5} height={14}>
          <span className="deploy-chart-tick deploy-chart-tick-left deploy-axis-served deploy-axis-served-zero">0</span>
        </foreignObject>
        <foreignObject x={plotRight + 5} y={plotTop - 5} width={width - plotRight - 5} height={14}>
          <span className="deploy-chart-tick deploy-axis-busy deploy-axis-busy-max">{number(busyTick)}</span>
        </foreignObject>
        <foreignObject x={plotRight + 5} y={plotBottom - 5} width={width - plotRight - 5} height={14}>
          <span className="deploy-chart-tick deploy-axis-busy deploy-axis-busy-zero">0</span>
        </foreignObject>
        {[0, 6, 12, 18, 23].map((hour) => (
          <text key={hour} x={x(hour)} y={height - 8} textAnchor="middle" className="deploy-axis">
            {hour}时
          </text>
        ))}
      </svg>
      <p className="deploy-chart-throughput">
        {servedPerVehicleHour === null
          ? '当前情景没有在跑车辆，无法计算每辆车每小时接走单数。'
          : `每辆车每小时接走 ${servedPerVehicleHour.toFixed(2)} 单`}
      </p>
    </>
  )
}

export default function DeploymentPanel() {
  const [data, setData] = useState<DeploymentData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [chosenKind, setChosenKind] = useState<string | null>(null)
  const [chosenArea, setChosenArea] = useState<string | null>(null)
  const [chosenFleet, setChosenFleet] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/fleet/deployment', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`/api/fleet/deployment ${response.status}`)
        return response.json() as Promise<DeploymentData>
      })
      .then(setData)
      .catch((cause) => {
        if (cause.name !== 'AbortError') setError('投放情景还没生成，先跑 pipeline/32 和 pipeline/33')
      })
    return () => controller.abort()
  }, [])

  if (error) return <aside className="deploy-panel deploy-empty">{error}</aside>
  if (!data) return null

  // Keep the source order, but also expose kinds and areas that only appear in future scenarios.
  const kinds = [...new Set([...data.kinds, ...data.scenarios.map((scenario) => scenario.kind)])]
    .filter((kind) => data.scenarios.some((scenario) => scenario.kind === kind))
  const kind = chosenKind && kinds.includes(chosenKind) ? chosenKind : kinds[0]
  const kindScenarios = data.scenarios.filter((scenario) => scenario.kind === kind)
  const areas = [...new Set([...data.areas, ...kindScenarios.map((scenario) => scenario.area)])]
    .filter((area) => kindScenarios.some((scenario) => scenario.area === area))
  const area = chosenArea && areas.includes(chosenArea) ? chosenArea : areas[0]
  const fleets = [...new Set(kindScenarios.filter((scenario) => scenario.area === area)
    .map((scenario) => scenario.av_fleet))].sort((a, b) => a - b)
  const fleet = chosenFleet !== null && fleets.includes(chosenFleet)
    ? chosenFleet : fleets[fleets.length - 1]
  const scenario = kindScenarios.find((item) => item.area === area && item.av_fleet === fleet)

  if (!scenario) return null

  const utilization = fleet > 0 ? scenario.summary.av_busy_peak / fleet * 100 : 0
  const outside = fleet > 0 ? scenario.summary.av_outside_area_peak / fleet * 100 : 0
  const waitChange = scenario.vs_baseline.wait_in_area_min
  const kmChange = scenario.vs_baseline.total_vehicle_km_pct * 100

  return (
    <aside className={`deploy-panel${open ? '' : ' deploy-closed'}`}>
      <button className="deploy-toggle" onClick={() => setOpen(!open)}
              aria-expanded={open} aria-controls="deploy-body">
        无人车情景 {open ? '▾' : '▸'}
      </button>
      {open && (
        <div id="deploy-body" className="deploy-body">
          <p className="deploy-lead">
            {kind === 'deployment'
              ? '在某个区投放无人车，的士车队保持不变。看加车能改变多少。'
              : `查看「${kindName(kind)}」情景下的服务与车辆运行结果。`}
          </p>

          <div className="deploy-picker" aria-label="情景类型">
            <span className="deploy-picker-label">情景类型</span>
            <div className="deploy-options">
              {kinds.map((item) => (
                <button key={item} type="button" className="deploy-option"
                        aria-pressed={item === kind} onClick={() => {
                          setChosenKind(item)
                          setChosenArea(null)
                          setChosenFleet(null)
                        }}>
                  {kindName(item)}
                </button>
              ))}
            </div>
          </div>

          <div className="deploy-picker" aria-label="投放区域">
            <span className="deploy-picker-label">区域</span>
            <div className="deploy-options">
              {areas.map((item) => (
                <button key={item} type="button" className="deploy-option"
                        aria-pressed={item === area} onClick={() => {
                          setChosenArea(item)
                          setChosenFleet(null)
                        }}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="deploy-picker" aria-label="无人车车队规模">
            <span className="deploy-picker-label">无人车规模</span>
            <div className="deploy-options">
              {fleets.map((item) => (
                <button key={item} type="button" className="deploy-option"
                        aria-pressed={item === fleet} onClick={() => setChosenFleet(item)}>
                  {item === 0 ? '0 · 基准' : `${number(item)} 辆`}
                </button>
              ))}
            </div>
          </div>

          <div className="deploy-metrics">
            <div className="deploy-metric">
              <strong>{(scenario.summary.av_share_in_area * 100).toFixed(1)}%</strong>
              <span>无人车接走区内行程</span>
            </div>
            <div className="deploy-metric">
              <strong>{scenario.summary.wait_in_area_min.toFixed(2)} 分钟</strong>
              <span>区内平均等待</span>
            </div>
            <div className="deploy-metric">
              <strong className={changeClass(waitChange)}>{signed(waitChange, 2)} 分钟</strong>
              <span>较基准等待变化</span>
            </div>
            <div className="deploy-metric">
              <strong className={changeClass(kmChange)}>{signed(kmChange, 2)}%</strong>
              <span>总车公里变化</span>
            </div>
          </div>

          <div className="deploy-utilization">
            <span className="deploy-utilization-label">利用率</span>
            <strong>{fleet > 0 ? `最忙一小时只有 ${Math.round(utilization)}% 在跑` : '基准情景未投放无人车'}</strong>
            <div className="deploy-utilization-track" role="meter" aria-label="最忙一小时在跑的无人车比例"
                 aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(utilization)}>
              <span style={{ width: `${Math.min(100, Math.max(0, utilization))}%` }} />
            </div>
          </div>

          <h4 className="deploy-sub">逐小时：接走行程与在跑车辆</h4>
          <div className="deploy-chart-key">
            <span className="deploy-key-served">接走行程（单）</span>
            <span className="deploy-key-busy">在跑车辆（辆）</span>
          </div>
          <HourChart rows={scenario.hourly} />

          <p className="deploy-drift">
            {fleet > 0
              ? `全天最多有 ${Math.round(outside)}% 的无人车停在投放区外（区域牌照只限制在哪接客，不限制车停在哪）`
              : '基准情景未投放无人车。'}
          </p>

          <details className="deploy-limits">
            <summary>这些数字的局限</summary>
            <ul>{data.limits.map((limit, index) => <li key={`${index}-${limit}`}>{limit}</li>)}</ul>
          </details>
        </div>
      )}
    </aside>
  )
}
