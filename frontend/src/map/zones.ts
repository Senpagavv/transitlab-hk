import type { Theme } from '../i18n'
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
}

export type ZoneFeature = Feature<Polygon | MultiPolygon, ZoneProps>
export type ZoneCollection = FeatureCollection<Polygon | MultiPolygon, ZoneProps>

type RGB = [number, number, number]

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB

// Game-coordinated colours. All existing bin tests and numeric thresholds are unchanged.
const GREEN = ['#FFFCF7', '#9fc796', '#71a77b', '#458e65', '#216d50', '#0b5037'].map(hex)
const BLUE = ['#FFFCF7', '#9cbad8', '#779fc5', '#4e80b1', '#2e6598', '#1b4c79'].map(hex)
const TEAL = ['#FFFCF7', '#b4d3c7', '#85b8a7', '#569989', '#337b70', '#165c55'].map(hex)
const SAND = ['#FFFCF7', '#e3d3a6', '#cdb77a', '#b29a50', '#8f7934', '#695721'].map(hex)
const CLAY = ['#FFFCF7', '#e5c4b2', '#cea68e', '#b58366', '#966044', '#74412d'].map(hex)
const BROWN = ['#8c5626', '#b47846', '#d5a075'].map(hex)
const GROWTH = ['#9fc796', '#458e65', '#0b5037'].map(hex)
const NEUTRAL = hex('#e4e3de')

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
function steps(ramp: RGB[], edges: number[], labels: string[], zero?: string): ZoneClass[] {
  const out: ZoneClass[] = []
  if (zero) out.push({ label: zero, color: NEUTRAL, test: (v) => v <= 0 })
  edges.forEach((low, i) => {
    const high = edges[i + 1] ?? Infinity
    out.push({
      label: labels[i],
      color: ramp[i],
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
    classes: steps(GREEN,
      [0, 5000, 20000, 40000, 70000, 100000],
      ['< 5千', '5千 – 2万', '2 – 4万', '4 – 7万', '7 – 10万', '≥ 10万'],
    ),
  },
  {
    id: 'growth',
    name: '人口变化',
    unit: '2021 → 2026 年',
    note: '规划署推算；褐色为减少，绿色为增加',
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
    classes: steps(BLUE,
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
    classes: steps(TEAL,
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
    classes: steps(SAND,
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
    classes: steps(CLAY,
      [0, 15, 20, 24, 28, 32],
      ['< 15%', '15 – 20%', '20 – 24%', '24 – 28%', '28 – 32%', '≥ 32%'],
    ),
  },
]

export function zoneColor(metric: ZoneMetric, zone: ZoneProps): RGB {
  const v = metric.value(zone)
  if (v === null || Number.isNaN(v)) return NEUTRAL
  return (metric.classes.find((c) => c.test(v)) ?? metric.classes[metric.classes.length - 1]).color
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
      .then((data) => {
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

// The legend and the map use the same colour conversion in the optional ink theme.
const DARK_RAMPS = [
  [GREEN, ['#28332c','#3f6043','#4f7a4a','#65a25d','#89bd80','#b4dbac']],
  [BLUE, ['#28333d','#3f6585','#4c7aa2','#6394bf','#85b1d8','#b3d4ee']],
  [TEAL, ['#263530','#345c50','#477d6d','#5c9d8b','#87c1b0','#b3dfd0']],
  [SAND, ['#343125','#625732','#84713e','#a38a4f','#c6ab6a','#e4cc91']],
  [CLAY, ['#352d28','#624c40','#87634f','#aa7d62','#c99d7e','#e6bea0']],
  [BROWN, ['#e1ba84','#b18b59','#785f3f']],
  [[NEUTRAL], ['#353a36']],
] as const

export function themeColor(color: RGB, theme: Theme): RGB {
  if (theme === 'light') return color
  for (const [light, dark] of DARK_RAMPS) {
    const index = light.findIndex(c => c.every((v, i) => v === color[i]))
    if (index >= 0) return hex(dark[index])
  }
  return color
}
