import { useEffect, useRef, useState } from 'react'

// Live traffic from the Transport Department's road detectors, via the backend.
// Drawn as lines along the roads: colour is congestion (speed against that detector's own free-flow
// speed), width is how much traffic there is, so the eye lands on busy roads first and red marks the
// jams. Detectors with no line through them are not drawn at all - a lone dot beside no line reads as
// a smudge, and the legend explains the gap instead (pipeline/15b puts them in `unmatched`).

export interface LiveLane {
  name: string // as the feed names it: "Fast Lane", "Middle Lane 1", "Slow Lane"
  vehicles_per_hour: number
  speed_kph: number | null
  occupancy_pct: number | null
}

export interface LiveDetector {
  id: string
  lon: number
  lat: number
  road_zh: string
  road_en: string
  direction: string
  vehicles_per_hour: number
  speed_kph: number | null // the average vehicle's speed over all its lanes
  free_flow_kph: number | null
  congestion: number | null
  lanes: LiveLane[]
}

/** "Fast Lane" -> 快线, "Middle Lane 2" -> 中线 2, "Slow Lane" -> 慢线. */
export function laneName(name: string): string {
  return name
    .replace(/^Fast Lane/, '快线')
    .replace(/^Middle Lane/, '中线')
    .replace(/^Slow Lane/, '慢线')
    .trim()
}

export interface LiveTrafficSnapshot {
  observed_at: string
  source: string
  detectors: LiveDetector[]
}

// The upstream feed is rewritten about every 3 minutes; polling every 30 s keeps the map within
// one update of the source without asking too often.
const POLL_MS = 30_000
const BUSY_FLOW = 4000 // vehicles/hour treated as "very busy" when setting line width

export type Rgb = [number, number, number]

const RAMP: { at: number; color: Rgb }[] = [
  { at: 0.0, color: [96, 178, 120] }, // free flowing: muted, so jams stand out
  { at: 0.3, color: [163, 199, 62] },
  { at: 0.5, color: [242, 194, 48] },
  { at: 0.7, color: [239, 125, 42] },
  { at: 1.0, color: [226, 59, 46] }, // stopped
]

const UNKNOWN: Rgb = [150, 155, 160] // detector reporting flow but no valid speed

export function congestionColor(congestion: number | null): Rgb {
  if (congestion === null) return UNKNOWN
  const value = Math.min(1, Math.max(0, congestion))
  let lower = RAMP[0]
  let upper = RAMP[RAMP.length - 1]
  for (let i = 0; i < RAMP.length - 1; i++) {
    if (value >= RAMP[i].at && value <= RAMP[i + 1].at) {
      lower = RAMP[i]
      upper = RAMP[i + 1]
      break
    }
  }
  const span = upper.at - lower.at || 1
  const t = (value - lower.at) / span
  return [0, 1, 2].map((i) => Math.round(lower.color[i] + (upper.color[i] - lower.color[i]) * t)) as Rgb
}

/** How busy a road is, on a 0-1 scale, used to set a line's width. */
export function flowWeight(vehiclesPerHour: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, vehiclesPerHour) / BUSY_FLOW))
}


/**
 * A continuous line along a road through several detectors (static; built by pipeline/15b).
 * Every vertex names the detectors before and after it (indexes into `detectors`) and how far
 * along it is between them, so the line can be shaded smoothly from one reading to the next.
 */
export interface TrafficCorridor {
  detectors: string[]
  path: [number, number][]
  a: number[]
  b: number[]
  t: number[]
}

export interface TrafficCorridors {
  corridors: TrafficCorridor[]
  unmatched: string[]
}

/** Fetched once: the lines only change when the detector list or the road network does. */
export function useTrafficCorridors() {
  const [data, setData] = useState<TrafficCorridors | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/traffic/corridors')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: TrafficCorridors) => {
        if (!cancelled) setData(body)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return data
}

/**
 * One colour per vertex. Congestion is blended between the two detectors either side and only then
 * turned into a colour, so the line runs through the same ramp the legend shows. A detector with no
 * valid speed hands over to its neighbour; with neither, the stretch is grey.
 */
export function corridorColors(corridor: TrafficCorridor, readings: Map<string, LiveDetector>): Rgb[] {
  const congestion = corridor.detectors.map((id) => readings.get(id)?.congestion ?? null)
  return corridor.a.map((a, i) => {
    const before = congestion[a]
    const after = congestion[corridor.b[i]]
    if (before === null && after === null) return UNKNOWN
    if (before === null) return congestionColor(after)
    if (after === null) return congestionColor(before)
    return congestionColor(before + (after - before) * corridor.t[i])
  })
}

/** One width per line, from the average traffic its detectors report. */
export function corridorWidth(corridor: TrafficCorridor, readings: Map<string, LiveDetector>): number {
  const flows = corridor.detectors.map((id) => readings.get(id)?.vehicles_per_hour).filter((v): v is number => v != null)
  const mean = flows.length ? flows.reduce((sum, v) => sum + v, 0) / flows.length : 0
  return 2.5 + 3.5 * flowWeight(mean)
}

/** Polls the backend and only updates state when the source has actually published a new reading. */
export function useLiveTraffic(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<LiveTrafficSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const observedAt = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()

    async function poll() {
      try {
        const res = await fetch('/api/traffic/live', { signal: controller.signal })
        if (!res.ok) throw new Error(String(res.status))
        const data: LiveTrafficSnapshot = await res.json()
        setFailed(false)
        // The feed sits behind several caches and occasionally serves a slightly older snapshot,
        // so only move forward in time (ISO timestamps compare correctly as strings).
        if (!observedAt.current || data.observed_at > observedAt.current) {
          observedAt.current = data.observed_at
          setSnapshot(data) // new reading: let the layer animate to it
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      }
    }

    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => {
      controller.abort()
      clearInterval(timer)
    }
  }, [enabled])

  return { snapshot, failed }
}
