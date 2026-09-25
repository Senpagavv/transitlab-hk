import { useEffect, useMemo, useState } from 'react'

// What pipeline/31_fleet_simulator.py writes to data/web/fleet-scenarios.json.
interface SweepPoint {
  fleet: number
  served_share: number
  mean_wait_min: number
  empty_share: number
  peak_busy: number
}
interface HourRow {
  hour: number
  requests: number
  served: number
  vehicles_busy: number
  mean_wait_min: number
  empty_km: number
  paid_km: number
}
interface Scenarios {
  base_fleet: number
  max_wait_min: number
  hourly: HourRow[]
  sweep: SweepPoint[]
  limits: string[]
}

const n = (v: number) => Math.round(v).toLocaleString('zh-CN')
// Service is good, stretched, or broken. The thresholds are the ones pipeline/31 checks against.
const grade = (p: SweepPoint) =>
  p.served_share >= 0.95 && p.mean_wait_min <= 5 ? 'ok' : p.served_share >= 0.9 ? 'tight' : 'broken'

function Curve({ sweep, chosen, onPick }: { sweep: SweepPoint[]; chosen: number; onPick: (f: number) => void }) {
  const w = 300
  const h = 110
  const points = [...sweep].sort((a, b) => a.fleet - b.fleet)
  const maxFleet = Math.max(...points.map((p) => p.fleet))
  const maxWait = Math.max(6, ...points.map((p) => p.mean_wait_min))
  const x = (f: number) => 28 + (f / maxFleet) * (w - 40)
  const y = (m: number) => h - 22 - (m / maxWait) * (h - 38)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.fleet)},${y(p.mean_wait_min)}`).join(' ')
  return (
    <svg className="fleet-curve" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="车队规模与平均等待时间">
      {/* the five-minute line is the service promise */}
      <line x1={28} y1={y(5)} x2={w - 12} y2={y(5)} className="fleet-target" />
      <text x={30} y={y(5) - 4} className="fleet-axis">5 分钟</text>
      <path d={path} className="fleet-line" />
      {points.map((p) => (
        <g key={p.fleet} onClick={() => onPick(p.fleet)} className="fleet-dot-hit">
          <circle cx={x(p.fleet)} cy={y(p.mean_wait_min)} r={p.fleet === chosen ? 6 : 4}
                  className={`fleet-dot fleet-${grade(p)}`} />
        </g>
      ))}
      <text x={28} y={h - 6} className="fleet-axis">车队规模 →</text>
    </svg>
  )
}

function Hours({ rows }: { rows: HourRow[] }) {
  const w = 300
  const h = 88
  const max = Math.max(...rows.map((r) => r.requests))
  const bw = (w - 32) / 24
  return (
    <svg className="fleet-hours" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="逐小时叫车需求">
      {rows.map((r) => (
        <rect key={r.hour} x={28 + r.hour * bw} y={h - 18 - (r.requests / max) * (h - 26)}
              width={bw - 1.5} height={(r.requests / max) * (h - 26)} className="fleet-bar" />
      ))}
      {[0, 6, 12, 18].map((t) => (
        <text key={t} x={28 + t * bw} y={h - 5} className="fleet-axis">{t}时</text>
      ))}
    </svg>
  )
}

export default function FleetPanel() {
  const [data, setData] = useState<Scenarios | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/fleet/scenarios', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`/api/fleet/scenarios ${res.status}`)
        return res.json() as Promise<Scenarios>
      })
      .then((json) => {
        setData(json)
        setChosen(json.base_fleet)
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setError('车队情景还没生成，先跑 pipeline/31_fleet_simulator.py')
      })
    return () => controller.abort()
  }, [])

  const point = useMemo(
    () => data?.sweep.find((p) => p.fleet === chosen) ?? data?.sweep[0] ?? null,
    [data, chosen],
  )
  // The smallest fleet that still keeps the promise, which is the number the whole thing is for.
  const smallest = useMemo(() => {
    const good = data?.sweep.filter((p) => grade(p) === 'ok') ?? []
    return good.length ? good.reduce((a, b) => (a.fleet < b.fleet ? a : b)) : null
  }, [data])

  if (error) return <aside className="fleet-panel fleet-empty">{error}</aside>
  if (!data || !point) return null

  return (
    <aside className={`fleet-panel${open ? '' : ' fleet-closed'}`}>
      <button className="fleet-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        车队沙盘 {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="fleet-body">
          <p className="fleet-lead">
            一个工作日 <b>{n(data.hourly.reduce((s, r) => s + r.requests, 0))}</b> 单叫车需求，
            由中央调度的车队来跑。点曲线上的圆点换车队规模。
          </p>

          <Curve sweep={data.sweep} chosen={point.fleet} onPick={setChosen} />

          <div className="fleet-figures">
            <div>
              <span className="fleet-value">{n(point.fleet)}</span>
              <span className="fleet-label">辆</span>
            </div>
            <div>
              <span className={`fleet-value fleet-${grade(point)}-text`}>
                {(point.served_share * 100).toFixed(1)}%
              </span>
              <span className="fleet-label">接单率</span>
            </div>
            <div>
              <span className="fleet-value">{point.mean_wait_min.toFixed(1)}</span>
              <span className="fleet-label">分钟等待</span>
            </div>
            <div>
              <span className="fleet-value">{(point.empty_share * 100).toFixed(0)}%</span>
              <span className="fleet-label">空驶占比</span>
            </div>
          </div>

          {smallest && (
            <p className="fleet-headline">
              接单率 ≥95%、平均等待 ≤5 分钟的<b>最小车队是 {n(smallest.fleet)} 辆</b>，
              比今天的领牌车队 {n(data.base_fleet)} 辆少{' '}
              <b>{Math.round((1 - smallest.fleet / data.base_fleet) * 100)}%</b>。
            </p>
          )}

          <h4 className="fleet-sub">逐小时需求</h4>
          <Hours rows={data.hourly} />

          <details className="fleet-limits">
            <summary>这个数字的四条局限</summary>
            <ul>
              {data.limits.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </aside>
  )
}
