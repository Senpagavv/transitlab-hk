import { setWorkerCount, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre 6 finds its worker file relative to its own module URL. Vite pre-bundles the library
// into another folder, so that lookup 404s and vector tiles never render (raster tiles did not
// need the worker). Point MapLibre at a Vite-built copy of the worker instead.
setWorkerUrl(workerUrl)

// MapLibre parses vector tiles in a single worker by default (except in Safari). This basemap's
// tiles are heavy, and after a zoom a dozen of them queue behind each other in that one worker.
// Measured 2026-09-15 (cached tiles, zoom 12 -> 16): ~0.6 s to reveal with 1 worker, ~0.45 s with 4;
// 6 or 8 were no better and cost more memory.
setWorkerCount(Math.min(4, Math.max(1, Math.floor(navigator.hardwareConcurrency / 2))))
