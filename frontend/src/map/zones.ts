import { useEffect, useState } from 'react'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'

// The model zones (455) and the 2026 figures the model runs on (built by pipeline/19).
export interface ZoneProps {
  zone: string
  label: string
  district: string
  population: number
  population_2021: number
  growth_pct: number | null
  density: number | null
  households: number
  workers: number
  students: number
  elderly_pct: number | null
  floor_jobs_m2: number
  floor_office_m2: number
  floor_retail_m2: number
  floor_industrial_m2: number
  floor_jobs_density: number | null
  school_places: number
  tertiary_places: number
  hospital_m2: number
  jobs: number
  jobs_density: number | null
  trips_out: number
  trips_in: number
  trips_crossing: number
  area_km2: number
  road_access: boolean
  // Added by useZones from /api/fleet/scenarios (pipeline/31); absent until that file exists.
  taxi_requests?: number
  served_share?: number | null
  served_share_small?: number | null
  wait_min?: number | null
}

export type ZoneFeature = Feature<Polygon | MultiPolygon, ZoneProps>
export type ZoneCollection = FeatureCollection<Polygon | MultiPolygon, ZoneProps>

type RGB = [number, number, number]

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB

// Ramps validated with the dataviz ordinal checks against the basemap ground (#f3f4ec): one hue,
// monotone lightness, light end >= 2:1. Violet keeps clear of the sea (blue) and of live traffic
// (green -> red); the decline arm is brown, and "about the same" is a receding grey.
const VIOLET = ['#b5a0dd', '#a187d0', '#8e6fc1', '#7959ad', '#654694', '#51347a'].map(hex)
const BROWN = ['#8c5626', '#b47846', '#d5a075'].map(hex) // strongest decline first
const GROWTH = ['#b5a0dd', '#8e6fc1', '#654694'].map(hex)
const NEUTRAL = hex('#dededb')

export interface ZoneClass {
  label: string
  color: RGB
  test: (v: number) => boolean
}

export interface ZoneMetric {
  id: string
  name: string
  unit: string
  note: string
  value: (z: ZoneProps) => number | null
  format: (v: number) => string
  classes: ZoneClass[]
}

const wan = (v: number) => (v >= 10000 ? `${+(v / 10000).toFixed(v >= 100000 ? 0 : 1)}万` : v.toLocaleString('zh-CN'))

/** Ordered bins over a one-hue ramp; `zero` adds a grey class for "none at all". */
function steps(edges: number[], labels: string[], zero?: string): ZoneClass[] {
  const out: ZoneClass[] = []
  if (zero) out.push({ label: zero, color: NEUTRAL, test: (v) => v <= 0 })
  edges.forEach((low, i) => {
    const high = edges[i + 1] ?? Infinity
    out.push({
      label: labels[i],
      color: VIOLET[i],
      test: (v) => (zero ? v > 0 : true) && v >= low && v < high,
    })
  })
  return out
}

export const ZONE_METRICS: ZoneMetric[] = [
  {
    id: 'density',
    name: '人口密度',
    unit: '人/平方公里，2026 年',
    note: '规划署推算；分区内按住宅楼面分摊，属估算',
    value: (z) => z.density,
    format: (v) => `${wan(Math.round(v))} 人/km²`,
    classes: steps(
      [0, 5000, 20000, 40000, 70000, 100000],
      ['< 5千', '5千 – 2万', '2 – 4万', '4 – 7万', '7 – 10万', '≥ 10万'],
    ),
  },
  {
    id: 'growth',
    name: '人口变化',
    unit: '2021 → 2026 年',
    note: '规划署推算；褐色为减少，紫色为增加',
    value: (z) => z.growth_pct,
    format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`,
    classes: [
      { label: '减少 8% 以上', color: BROWN[0], test: (v) => v < -8 },
      { label: '减少 4 – 8%', color: BROWN[1], test: (v) => v >= -8 && v < -4 },
      { label: '减少 1 – 4%', color: BROWN[2], test: (v) => v >= -4 && v < -1 },
      { label: '基本不变', color: NEUTRAL, test: (v) => v >= -1 && v <= 1 },
      { label: '增加 1 – 10%', color: GROWTH[0], test: (v) => v > 1 && v <= 10 },
      { label: '增加 10 – 40%', color: GROWTH[1], test: (v) => v > 10 && v <= 40 },
      { label: '增加 40% 以上', color: GROWTH[2], test: (v) => v > 40 },
    ],
  },
  {
    id: 'jobs',
    name: '岗位密度',
    unit: '个/平方公里，2026 年',
    note: '规划署 18 区就业总数；分区内按楼面用途和人口分摊，属估算',
    value: (z) => z.jobs_density,
    format: (v) => `${wan(Math.round(v))} 个/km²`,
    classes: steps(
      [0, 1000, 5000, 15000, 40000, 100000],
      ['< 1千', '1千 – 5千', '5千 – 1.5万', '1.5 – 4万', '4 – 10万', '≥ 10万'],
    ),
  },
  {
    id: 'trips',
    name: '每日到达出行',
    unit: '人次，2026 年工作日，坐车或开车',
    note: '按运输署出行调查 2022 分区吸引量校准；不含全程步行、单车',
    value: (z) => z.trips_in,
    format: (v) => `${wan(Math.round(v))} 人次`,
    classes: steps(
      [0, 5000, 10000, 20000, 50000, 100000],
      ['< 5千', '5千 – 1万', '1 – 2万', '2 – 5万', '5 – 10万', '≥ 10万'],
    ),
  },
  {
    id: 'schools',
    name: '中小学及幼稚园学额',
    unit: '个',
    note: '学校位置为实测；学额按区内学校平均分摊，属估算',
    value: (z) => z.school_places,
    format: (v) => `${Math.round(v).toLocaleString('zh-CN')} 个`,
    classes: steps(
      [0, 500, 1000, 2000, 3500, 6000],
      ['< 500', '500 – 1千', '1千 – 2千', '2千 – 3.5千', '3.5千 – 6千', '≥ 6千'],
      '没有学校',
    ),
  },
  {
    id: 'elderly',
    name: '65 岁以上占比',
    unit: '2026 年',
    note: '规划署各区年龄推算；分区内按住宅楼面分摊，属估算',
    value: (z) => z.elderly_pct,
    format: (v) => `${v.toFixed(1)}%`,
    classes: steps(
      [0, 15, 20, 24, 28, 32],
      ['< 15%', '15 – 20%', '20 – 24%', '24 – 28%', '28 – 32%', '≥ 32%'],
    ),
  },
  {
    id: 'taxi_demand',
    name: '叫车需求',
    unit: '一个工作日，出发端，2026 年',
    note: 'pipeline/28 把的士人次矩阵展开成逐条请求；总量锚定运输署月报的载客量',
    value: (z) => z.taxi_requests ?? null,
    format: (v) => `${wan(Math.round(v))} 单`,
    classes: steps(
      [0, 500, 1500, 3000, 6000, 12000],
      ['< 500', '500 – 1.5千', '1.5 – 3千', '3 – 6千', '6千 – 1.2万', '≥ 1.2万'],
      '没有需求',
    ),
  },
  {
    id: 'service_small',
    name: '车队缩到 8 千辆时的接单率',
    unit: '与今天的 17,695 辆相比',
    note: 'pipeline/31 的调度模拟；红色是先被放弃的地方，多为偏远分区',
    value: (z) => (z.served_share_small == null ? null : z.served_share_small * 100),
    format: (v) => `${v.toFixed(0)}%`,
    // Low is bad here, so the ramp is reversed: the deepest colour marks the worst service.
    classes: [
      { label: '没有需求', color: NEUTRAL, test: (v) => !(v > 0) },
      { label: '< 60%（先被放弃）', color: VIOLET[5], test: (v) => v > 0 && v < 60 },
      { label: '60 – 75%', color: VIOLET[4], test: (v) => v >= 60 && v < 75 },
      { label: '75 – 85%', color: VIOLET[3], test: (v) => v >= 75 && v < 85 },
      { label: '85 – 90%', color: VIOLET[2], test: (v) => v >= 85 && v < 90 },
      { label: '≥ 90%', color: VIOLET[1], test: (v) => v >= 90 },
    ],
  },
]

export function zoneColor(metric: ZoneMetric, zone: ZoneProps): RGB {
  const v = metric.value(zone)
  if (v === null || Number.isNaN(v)) return NEUTRAL
  return (metric.classes.find((c) => c.test(v)) ?? metric.classes[metric.classes.length - 1]).color
}

interface FleetZone {
  zone: string
  requests: number
  served_share: number
  mean_wait_min: number
}

/** The fleet simulation, keyed by zone. Missing is fine - the two fleet metrics then show nothing. */
async function fleetByZone(signal: AbortSignal): Promise<Map<string, [FleetZone, FleetZone]>> {
  const res = await fetch('/api/fleet/scenarios', { signal })
  if (!res.ok) return new Map()
  const data = (await res.json()) as { zones: { base: FleetZone[]; small: FleetZone[] } }
  const small = new Map(data.zones.small.map((r) => [r.zone, r]))
  const out = new Map<string, [FleetZone, FleetZone]>()
  for (const base of data.zones.base) {
    const pair = small.get(base.zone)
    if (pair) out.set(base.zone, [base, pair])
  }
  return out
}

export function useZones(enabled: boolean) {
  const [zones, setZones] = useState<ZoneCollection | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled || zones) return
    const controller = new AbortController()
    fetch('/api/zones', { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`/api/zones ${res.status}`)
        return res.json() as Promise<ZoneCollection>
      })
      .then(async (data) => {
        const fleet = await fleetByZone(controller.signal).catch(() => new Map())
        for (const feature of data.features) {
          const pair = fleet.get(feature.properties.zone)
          if (!pair) continue
          const [base, small] = pair
          feature.properties.taxi_requests = base.requests
          feature.properties.served_share = base.served_share
          feature.properties.served_share_small = small.served_share
          feature.properties.wait_min = small.mean_wait_min
        }
        setZones(data)
        setFailed(false)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setFailed(true)
      })
    return () => controller.abort()
  }, [enabled, zones])

  return { zones, failed }
}
