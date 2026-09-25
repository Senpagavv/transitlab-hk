// Thin wrappers around the backend API. All calls go through /api (proxied to FastAPI in dev).

export type PlaceKind = 'mtr' | 'light_rail' | 'ferry' | 'bus_stop' | 'minibus_stop' | 'place'

export interface Place {
  name_zh: string
  name_en: string
  kind: PlaceKind
  address_zh: string
  district_zh: string
  lon: number
  lat: number
  source: string
}

// Answers are cached per query, so deleting back to an earlier input shows results instantly.
const cache = new Map<string, Place[]>()

async function getPlaces(path: string, query: string, signal?: AbortSignal): Promise<Place[]> {
  const url = `${path}?q=${encodeURIComponent(query)}`
  const cached = cache.get(url)
  if (cached) return cached

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  const places: Place[] = await res.json()
  cache.set(url, places)
  return places
}

/** Instant suggestions from the local transit index (stations and stops). */
export function suggestPlaces(query: string, signal?: AbortSignal) {
  return getPlaces('/api/places/suggest', query, signal)
}

/** Slower, broader search via the Lands Department API (buildings, addresses, facilities). */
export function searchPlaces(query: string, signal?: AbortSignal) {
  return getPlaces('/api/search', query, signal)
}
