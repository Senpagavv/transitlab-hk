import type { LngLat, Map as MapLibreMap } from 'maplibre-gl'

// ---------------------------------------------------------------------------------------------
// Zoom transition: hides the short wait for new vector tiles after a zoom.
//
// Each zoom band of the Lands Department basemap uses different data, so while the tiles for a new
// zoom level load, the old ones cannot be shown and the map would be blank. When the camera starts
// moving, the current (sharp) frame is snapshotted onto a 2D canvas above the map and kept
// geographically anchored. Only if the zoom actually changed and tiles are missing does it cover
// the map: the old picture follows the camera (softened when enlarged, so no giant blurry text) on
// a light land-coloured base. As soon as every tile for the new view is ready, the whole cover
// breaks open at once in a fraction of a second.
//
// Plain drags do not trigger it: newly exposed edges show the map's light background until they
// fill in. Runs on its own canvas and only during a zoom; assumes a north-up map without pitch.
// ---------------------------------------------------------------------------------------------

const ZOOM_TRIGGER_STRETCH = 1.15 // the picture must be scaled at least this much to count as a zoom
const READY_STABLE_MS = 100 // tiles must stay loaded (camera still) this long before revealing
const MAX_WAIT_MS = 4000 // reveal anyway if some tile never arrives
const SHATTER_MS = 300
const SHATTER_JITTER_MS = 50
const SHATTER_CELL_CSS_PX = 40
const SOFT_FROM_STRETCH = 1.3 // start softening the enlarged old picture
const SOFT_FULL_STRETCH = 2.5
const SOFT_DOWNSCALE = 8 // the softened copy is 1/8 size, upscaled smoothly = a cheap blur
const BACKDROP = 'rgb(243, 244, 236)' // same light land tone as the basemap background

interface Snapshot {
  sharp: ImageBitmap
  soft: HTMLCanvasElement
  width: number // device pixels
  height: number
  nw: LngLat
  se: LngLat
}

interface Shard {
  x: number
  y: number
  seed: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export class TransitionVeil {
  private readonly map: MapLibreMap
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly frozen = document.createElement('canvas') // cover frame the shatter breaks apart
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  private state: 'idle' | 'armed' | 'covering' | 'shattering' = 'idle'
  private generation = 0
  private snapshot: Snapshot | null = null
  private viewNW: LngLat | null = null // bounds of the last settled frame
  private viewSE: LngLat | null = null
  private moveEndedAt = 0
  private readySince = 0
  private shatterStart = 0
  private shards: Shard[] = []
  private raf = 0

  constructor(map: MapLibreMap) {
    this.map = map
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas not available')
    this.ctx = ctx
    Object.assign(this.canvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none' })
    map.getCanvas().insertAdjacentElement('afterend', this.canvas)

    this.rememberView()
    map.on('movestart', this.onMoveStart)
    map.on('moveend', this.onMoveEnd)
    map.on('idle', this.onIdle)
    map.on('resize', this.onResize)
  }

  destroy() {
    this.map.off('movestart', this.onMoveStart)
    this.map.off('moveend', this.onMoveEnd)
    this.map.off('idle', this.onIdle)
    this.map.off('resize', this.onResize)
    this.reset()
    this.canvas.remove()
  }

  /** State for automated visual checks (scripts/check-transition.mjs). */
  debugStats() {
    return { state: this.state, stretch: this.snapshot ? this.stretch(this.snapshot) : null }
  }

  // ---- map events -------------------------------------------------------------------------

  private onMoveStart = () => {
    if (this.state === 'covering') return this.kick() // still loading: keep the old picture
    this.reset()
    this.takeSnapshot()
    this.state = 'armed'
    this.kick()
  }

  private onMoveEnd = () => {
    this.rememberView()
    this.moveEndedAt = performance.now()
    this.kick()
  }

  private onIdle = () => {
    this.rememberView()
    if (this.state === 'armed') this.reset()
  }

  private onResize = () => {
    this.reset()
    this.rememberView()
  }

  private rememberView() {
    const bounds = this.map.getBounds()
    this.viewNW = bounds.getNorthWest()
    this.viewSE = bounds.getSouthEast()
  }

  private takeSnapshot() {
    const mapCanvas = this.map.getCanvas()
    const nw = this.viewNW
    const se = this.viewSE
    if (!nw || !se || !mapCanvas.width) return
    const generation = this.generation
    const { width, height } = mapCanvas
    createImageBitmap(mapCanvas)
      .then((sharp) => {
        if (generation !== this.generation) return sharp.close()
        const soft = document.createElement('canvas')
        soft.width = Math.max(1, Math.round(width / SOFT_DOWNSCALE))
        soft.height = Math.max(1, Math.round(height / SOFT_DOWNSCALE))
        const sctx = soft.getContext('2d')
        if (sctx) {
          sctx.imageSmoothingQuality = 'high'
          sctx.drawImage(sharp, 0, 0, soft.width, soft.height)
        }
        this.snapshot = { sharp, soft, width, height, nw, se }
      })
      .catch(() => undefined)
  }

  // ---- animation loop ---------------------------------------------------------------------

  private kick() {
    if (!this.raf && this.state !== 'idle') this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    const moving = this.map.isMoving()
    const loaded = this.map.areTilesLoaded()

    if (this.state === 'armed' && this.snapshot && !loaded && this.stretch(this.snapshot) >= ZOOM_TRIGGER_STRETCH) {
      this.state = 'covering'
      this.readySince = 0
    }

    if (this.state === 'covering') {
      this.syncCanvasSize()
      this.drawCover(this.ctx)
      // areTilesLoaded() can report true for an instant before MapLibre requests the tiles for a
      // new view, so the view must stay loaded - with the camera at rest - for a moment.
      const settled = !moving && now - this.moveEndedAt >= READY_STABLE_MS
      this.readySince = settled && loaded ? this.readySince || now : 0
      const ready = this.readySince > 0 && now - this.readySince >= READY_STABLE_MS
      if (ready || (!moving && now - this.moveEndedAt > MAX_WAIT_MS)) this.startShatter(now)
    }

    if (this.state === 'shattering' && !this.drawShatter(now)) return this.reset()

    if (this.state !== 'idle') this.raf = requestAnimationFrame(this.frame)
  }

  private reset() {
    this.state = 'idle'
    this.generation++
    this.snapshot?.sharp.close()
    this.snapshot = null
    this.shards = []
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  // ---- drawing ------------------------------------------------------------------------------

  private syncCanvasSize() {
    const mapCanvas = this.map.getCanvas()
    if (this.canvas.width !== mapCanvas.width || this.canvas.height !== mapCanvas.height) {
      this.canvas.width = mapCanvas.width
      this.canvas.height = mapCanvas.height
      this.canvas.style.width = mapCanvas.style.width
      this.canvas.style.height = mapCanvas.style.height
    }
  }

  /** How much the snapshot is scaled on screen now (>= 1 whether zoomed in or out). */
  private stretch(snapshot: Snapshot) {
    const scale = this.placement(snapshot).w / snapshot.width
    return scale >= 1 ? scale : 1 / scale
  }

  /** Where the snapshot sits on screen, in device pixels. */
  private placement(snapshot: Snapshot) {
    const pr = this.map.getPixelRatio()
    const a = this.map.project(snapshot.nw)
    const b = this.map.project(snapshot.se)
    return { x: a.x * pr, y: a.y * pr, w: (b.x - a.x) * pr, h: (b.y - a.y) * pr }
  }

  private drawCover(ctx: CanvasRenderingContext2D) {
    const snapshot = this.snapshot!
    const { x, y, w, h } = this.placement(snapshot)
    const soft = clamp01((this.stretch(snapshot) - SOFT_FROM_STRETCH) / (SOFT_FULL_STRETCH - SOFT_FROM_STRETCH))
    ctx.globalAlpha = 1
    ctx.fillStyle = BACKDROP
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.imageSmoothingEnabled = true
    if (soft < 1) {
      ctx.globalAlpha = 1
      ctx.drawImage(snapshot.sharp, x, y, w, h)
    }
    if (soft > 0) {
      ctx.globalAlpha = soft
      ctx.drawImage(snapshot.soft, x, y, w, h)
    }
    ctx.globalAlpha = 1
  }

  private startShatter(now: number) {
    this.frozen.width = this.canvas.width
    this.frozen.height = this.canvas.height
    const fctx = this.frozen.getContext('2d')
    if (!fctx) return this.reset()
    fctx.drawImage(this.canvas, 0, 0)

    const cell = Math.max(8, Math.round(SHATTER_CELL_CSS_PX * this.map.getPixelRatio()))
    this.shards = []
    for (let y = 0; y < this.canvas.height; y += cell) {
      for (let x = 0; x < this.canvas.width; x += cell) this.shards.push({ x, y, seed: Math.random() })
    }
    this.shatterStart = now
    this.state = 'shattering'
  }

  /** All shards break away together; returns false when the animation is over. */
  private drawShatter(now: number) {
    const { ctx, canvas } = this
    const cell = Math.max(8, Math.round(SHATTER_CELL_CSS_PX * this.map.getPixelRatio()))
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const pr = this.map.getPixelRatio()
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    let alive = false
    for (const shard of this.shards) {
      const p = clamp01((now - this.shatterStart - shard.seed * SHATTER_JITTER_MS) / SHATTER_MS)
      if (p >= 1) continue
      alive = true
      const w = Math.min(cell, canvas.width - shard.x)
      const h = Math.min(cell, canvas.height - shard.y)
      const mx = shard.x + w / 2
      const my = shard.y + h / 2
      const eased = p * p
      const angle = Math.atan2(my - cy, mx - cx) + (shard.seed - 0.5) * 0.8
      const drift = this.reducedMotion ? 0 : eased * (12 + 28 * shard.seed) * pr
      const scale = 1 - 0.5 * eased
      ctx.globalAlpha = 1 - p
      ctx.drawImage(
        this.frozen,
        shard.x,
        shard.y,
        w,
        h,
        mx + Math.cos(angle) * drift - (w * scale) / 2,
        my + Math.sin(angle) * drift - (h * scale) / 2,
        w * scale,
        h * scale,
      )
    }
    ctx.globalAlpha = 1
    return alive
  }
}
