import { styleForTheme } from './mapTheme'
import type { Theme } from '../i18n'
import { addProtocol, type RequestTransformFunction, type StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'

// Lands Department vector basemap + Traditional Chinese labels (free, no API key).
// Built by pipeline/02_build_basemap_style.py. Vector tiles stay sharp while zooming, and
// tiles only exist up to zoom 15, so zooming further in needs no downloads.
export const HK_BASEMAP_STYLE_URL = '/basemap/hk-vector-style.json'

// Terms of use: show the Lands Department logo on the map face plus the copyright notice.
export const LANDSD_LOGO_URL = 'https://api.hkmapservice.gov.hk/mapapi/landsdlogo.jpg'

const LABEL_FONTS_PATH = '/vt/label/hk/tc/WGS84/resources/fonts/'
const BASE_FONTS_PATH = '/vt/basemap/WGS84/resources/fonts/'
const LANDSD_API = 'https://mapapi.geodata.gov.hk/gs/api/v1.0.0/'

// Tiles, fonts and sprites go through the backend's disk cache (/api/basemap/...), which serves
// anything already downloaded in milliseconds and works offline. ?tiles=direct bypasses it.
const USE_LOCAL_CACHE = new URLSearchParams(window.location.search).get('tiles') !== 'direct'

export const transformBasemapRequest: RequestTransformFunction = (url, resourceType) => {
  let target = url
  // A style can name only one font server. Chinese label fonts come from the label service,
  // but "Arial Regular" (used by a few basemap layers) only exists on the basemap service.
  if (resourceType === 'Glyphs' && /Arial(%20| )Regular/.test(target)) {
    target = target.replace(LABEL_FONTS_PATH, BASE_FONTS_PATH)
  }
  if (USE_LOCAL_CACHE && target.startsWith(LANDSD_API)) {
    target = `${window.location.origin}/api/basemap/${target.slice(LANDSD_API.length)}`
  }
  return { url: target }
}

// Packaged basemap (pipeline/04_build_basemap_pmtiles.py): three PMTiles archives plus fonts and
// sprites, hostable on any static host or object storage. Set VITE_BASEMAP_PMTILES_BASE to their
// URL when deploying; locally, ?basemap=pmtiles reads the copy the backend serves.
const params = new URLSearchParams(window.location.search)
const PMTILES_BASE =
  import.meta.env.VITE_BASEMAP_PMTILES_BASE ?? (params.get('basemap') === 'pmtiles' ? '/api/basemap-pmtiles' : '')

const ARCHIVES: Record<string, string> = {
  'landsd-base': 'hk-landsd-base',
  'landsd-label': 'hk-landsd-label-tc',
  'landsd-raster-placeholder': 'hk-landsd-raster',
}

let protocolAdded = false

/** The basemap style: tiles via the backend cache by default, or from PMTiles archives when configured. */
export async function loadBasemapStyle(theme: Theme = 'light'): Promise<StyleSpecification> {
  const response = await fetch(HK_BASEMAP_STYLE_URL)
  if (!response.ok) throw new Error('Basemap style unavailable')
  const style = styleForTheme(await response.json() as StyleSpecification, theme)
  if (!PMTILES_BASE) return style

  const base = new URL(PMTILES_BASE, window.location.href).href.replace(/\/$/, '')
  if (!protocolAdded) { addProtocol('pmtiles', new Protocol().tile); protocolAdded = true }
  for (const [sourceId, archive] of Object.entries(ARCHIVES)) {
    const source = { ...style.sources[sourceId] } as { tiles?: string[]; url?: string }
    delete source.tiles
    source.url = `pmtiles://${base}/${archive}.pmtiles`
    style.sources[sourceId] = source as StyleSpecification['sources'][string]
  }
  const resources = `${base}/resources/`
  if (typeof style.sprite === 'string') style.sprite = style.sprite.replace(LANDSD_API, resources)
  if (style.glyphs) style.glyphs = style.glyphs.replace(LANDSD_API, resources)
  return style
}

export const HK_INITIAL_VIEW = { longitude: 114.12, latitude: 22.36, zoom: 10.3 }

// The vector service has no tiles below zoom 9.
export const HK_MIN_ZOOM = 9

// [west, south, east, north]
export const HK_MAX_BOUNDS: [number, number, number, number] = [113.7, 22.1, 114.6, 22.65]
