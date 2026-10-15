import { text, type Theme } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { StyleSpecification } from 'maplibre-gl'
import {
  Layer,
  Map as MapGL,
  NavigationControl,
  ScaleControl,
  Source,
  useControl,
  type MapEvent,
  type MapLayerMouseEvent,
  type MapRef,
} from 'react-map-gl/maplibre'
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox'
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import 'maplibre-gl/dist/maplibre-gl.css'
import './maplibreWorker'

import type { Place } from '../api/client'
import {
  HK_INITIAL_VIEW,
  HK_MAX_BOUNDS,
  HK_MIN_ZOOM,
  LANDSD_LOGO_URL,
  loadBasemapStyle,
  transformBasemapRequest,
} from './basemap'
import TransitionVeilLayer from './TransitionVeilLayer'
import TrafficLegend from './TrafficLegend'
import ZoneLegend from './ZoneLegend'
import ZonePanel from './ZonePanel'
import { ZONE_METRICS, useZones, zoneColor, themeColor, type ZoneProps } from './zones'
import {
  corridorColors,
  corridorWidth,
  laneName,
  useLiveTraffic,
  useTrafficCorridors,
  type LiveDetector,
  type TrafficCorridor,
} from './liveTraffic'

// The loading transition can be switched off with ?veil=off (handy for before/after comparisons).
// Tiles now come from the local cache and a new view is ready in ~0.2-0.3 s - shorter than the
// transition itself, so it is off unless asked for with ?veil=on.
const VEIL_ENABLED =new URLSearchParams(window.location.search).get('veil') === 'on'

// North-up planning map: no rotation or tilt (the loading transition also relies on this).
function lockNorthUp(e: MapEvent) {
  e.target.touchZoomRotate.disableRotation()
  e.target.keyboard.disableRotation()
  if (import.meta.env.DEV) Object.assign(window, { __map: e.target }) // for the scripts/ checks
}

// deck.gl draws the live traffic on top of the MapLibre basemap. (Its interleaved mode, which would
// let a deck layer sit under the place names, drew nothing at all with MapLibre 6 - no error, just
// an empty map - so the zones below are native MapLibre layers instead.)
function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl<MapboxOverlay>(() => new MapboxOverlay(props))
  overlay.setProps(props)
  return null
}

// Each line sits on the left of its own direction of travel (Hong Kong drives on the left), so the
// two directions of a street share its centreline without drawing over each other. The offset is in
// line widths, so the gap holds at every zoom.
const DRIVE_ON_LEFT = -0.65
const LINE_OPACITY = 235
const HALO: [number, number, number, number] = [255, 255, 255, 170]
const offsetStyle = new PathStyleExtension({ offset: true })

// The Lands Department style puts every place-name layer after the base map, all from one source.
// Zone fills go just before the first of them, so the names stay readable on top of the colours.
const LABEL_SOURCE = 'landsd-label'
const ZONE_FILL = 'zones-fill'

interface MapCanvasProps {
  theme: Theme
  selected: Place | null
}

export default function MapCanvas({ selected, theme }: MapCanvasProps) {
  const mapRef = useRef<MapRef>(null)
  const [mapStyle, setMapStyle] = useState<string | StyleSpecification | null>(null)
  const [styleFailed, setStyleFailed] = useState(false)
  const [legendOpen, setLegendOpen] = useState(false)
  const [trafficOn, setTrafficOn] = useState(true)
  const { snapshot: traffic, failed: trafficFailed } = useLiveTraffic(trafficOn)
  const corridors = useTrafficCorridors()
  const [zonesOn, setZonesOn] = useState(true)
  const [metric, setMetric] = useState(ZONE_METRICS[0])
  const [pickedZone, setPickedZone] = useState<ZoneProps | null>(null)
  const [labelLayer, setLabelLayer] = useState<string>()
  const [hoverZone, setHoverZone] = useState<string | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const { zones, failed: zonesFailed } = useZones(zonesOn)

  function handleLoad(e: MapEvent) {
    lockNorthUp(e)
    const layers = e.target.getStyle().layers ?? []
    setLabelLayer(layers.find((l) => 'source' in l && l.source === LABEL_SOURCE)?.id)
  }

  useEffect(() => {
    let current = true
    loadBasemapStyle(theme).then(style => { if (current) { setMapStyle(style); setStyleFailed(false) } }).catch(() => { if (current) setStyleFailed(true) })
    return () => { current = false }
  }, [theme])

  useEffect(() => {
    if (selected) {
      mapRef.current?.flyTo({ center: [selected.lon, selected.lat], zoom: 15 })
    }
  }, [selected])

  const readings = useMemo(() => new Map((traffic?.detectors ?? []).map((d) => [d.id, d])), [traffic])

  // Measured traffic as continuous lines along the roads: colour = congestion, shaded smoothly
  // from one detector to the next; width = how much traffic the line carries. The few detectors
  // that could not be placed on a road running their way stay as small dots. Switching the layer
  // off removes all of it.
  const trafficLayers = useMemo(() => {
    if (!trafficOn || !traffic || !corridors) return []
    const updateTriggers = { getColor: traffic.observed_at, getWidth: traffic.observed_at }
    const common = {
      data: corridors.corridors,
      getPath: (c: TrafficCorridor) => c.path,
      widthUnits: 'pixels' as const,
      capRounded: true,
      jointRounded: true,
      extensions: [offsetStyle],
      getOffset: DRIVE_ON_LEFT,
    }
    return [
      new PathLayer<TrafficCorridor>({
        ...common,
        id: 'live-traffic-halo',
        getColor: HALO,
        getWidth: (c) => corridorWidth(c, readings) + 2.5,
        updateTriggers: { getWidth: traffic.observed_at },
        transitions: { getWidth: 1500 },
      }),
      new PathLayer<TrafficCorridor>({
        ...common,
        id: 'live-traffic-lines',
        getColor: (c) => corridorColors(c, readings).map((rgb) => [...rgb, LINE_OPACITY]),
        getWidth: (c) => corridorWidth(c, readings),
        pickable: true,
        updateTriggers,
        transitions: { getColor: 1500, getWidth: 1500 },
      }),
    ]
  }, [trafficOn, traffic, corridors, readings])

  // Hovering a line names the detector nearest the pointer, with what it measures.
  function trafficTooltip(object: TrafficCorridor | LiveDetector, coordinate?: number[]) {
    let detector: LiveDetector | undefined
    if ('road_zh' in object) detector = object
    else if (coordinate) {
      const [x, y] = coordinate
      detector = object.detectors
        .map((id) => readings.get(id))
        .filter((d): d is LiveDetector => !!d)
        .sort((p, q) => Math.hypot(p.lon - x, p.lat - y) - Math.hypot(q.lon - x, q.lat - y))[0]
    }
    if (!detector) return null
    // Each lane as the detector measured it: the average hides a jammed slow lane beside a free fast one.
    const lanes = (detector.lanes ?? [])
      .map((lane) => `${text(laneName(lane.name))}：${lane.speed_kph ?? '—'} km/h · ${lane.vehicles_per_hour} ${text('辆/小时')}`)
      .join('<br/>')
    return {
      html: `<b>${detector.road_zh}</b><br/>${detector.vehicles_per_hour} ${text('辆/小时')}` +
        (detector.speed_kph ? ` · ${text('平均')} ${detector.speed_kph} km/h（${text('畅通约')} ${detector.free_flow_kph}）` : '') +
        (lanes ? `<br/><span style="opacity:.85">${lanes}</span>` : '') +
        ('detectors' in object ? `<br/><span style="opacity:.7">${text('两个探测器之间的颜色为插值')}</span>` : ''),
    }
  }

  // Each zone carries its colour for the chosen measure; MapLibre reads it straight off the feature.
  const zoneData = useMemo(
    () =>
      zones && {
        ...zones,
        features: zones.features.map((f) => ({
          ...f,
          properties: { ...f.properties, fill: `rgb(${themeColor(zoneColor(metric, f.properties), theme).join(',')})` },
        })),
      },
    [zones, metric, theme],
  )
  const zonesById = useMemo(
    () => new Map((zones?.features ?? []).map((f) => [f.properties.zone, f.properties])),
    [zones],
  )
  const hovered = hoverZone ? zonesById.get(hoverZone) : undefined

  // Feature properties come back from MapLibre serialised, so the full record is looked up by code.
  function zoneAt(e: MapLayerMouseEvent) {
    const code = e.features?.find((f) => f.layer.id === ZONE_FILL)?.properties?.zone as string | undefined
    return code ?? null
  }

  function handleClick(e: MapLayerMouseEvent) {
    const code = zoneAt(e)
    if (code) {
      setPickedZone(zonesById.get(code) ?? null)
      if (window.matchMedia('(max-width: 640px)').matches) setLegendOpen(false)
    }
  }

  function handleMouseMove(e: MapLayerMouseEvent) {
    const code = zoneAt(e)
    if (code !== hoverZone) setHoverZone(code)
    if (tipRef.current) tipRef.current.style.transform = `translate(${Math.max(4, Math.min(e.point.x + 14, e.target.getCanvas().clientWidth - 260))}px, ${Math.max(4, Math.min(e.point.y + 14, e.target.getCanvas().clientHeight - 75))}px)`
  }

  // Sized in screen pixels, so the marker stays the same size at every zoom level.
  // The search marker stays until the search box is cleared (App sets selected back to null).
  const markerLayers = useMemo(
    () =>
      selected
        ? [
            new ScatterplotLayer<Place>({
              id: 'selected-place-halo',
              data: [selected],
              getPosition: (d) => [d.lon, d.lat],
              radiusUnits: 'pixels',
              getRadius: 14,
              getFillColor: [14, 122, 78, 50],
            }),
            new ScatterplotLayer<Place>({
              id: 'selected-place',
              data: [selected],
              getPosition: (d) => [d.lon, d.lat],
              radiusUnits: 'pixels',
              getRadius: 6,
              getFillColor: [14, 122, 78, 255],
              stroked: true,
              lineWidthUnits: 'pixels',
              getLineWidth: 2,
              getLineColor: [255, 255, 255, 255],
            }),
          ]
        : [],
    [selected],
  )

  const layers = [...trafficLayers, ...markerLayers]

  if (!mapStyle) return <div className="map-loading" role="status">{text(styleFailed ? '底图读取失败，请刷新重试' : '正在读取地图…')}</div>

  return (
    <MapGL
      ref={mapRef}
      initialViewState={HK_INITIAL_VIEW}
      mapStyle={mapStyle}
      transformRequest={transformBasemapRequest}
      minZoom={HK_MIN_ZOOM}
      maxBounds={HK_MAX_BOUNDS}
      refreshExpiredTiles={false}
      hash // keeps the current view in the URL, so a page refresh stays in place
      fadeDuration={200} // short label fade: the view settles sooner
      dragRotate={false}
      pitchWithRotate={false}
      touchPitch={false}
      canvasContextAttributes={{ preserveDrawingBuffer: true }} // lets the transition snapshot the map
      onLoad={handleLoad}
      interactiveLayerIds={zonesOn && zoneData ? [ZONE_FILL] : []}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverZone(null)}
      cursor={hoverZone ? 'pointer' : undefined}
      style={{ width: '100%', height: '100%' }}
    >
      {zonesOn && zoneData && labelLayer && (
        <Source id="zones" type="geojson" data={zoneData}>
          <Layer
            id={ZONE_FILL}
            type="fill"
            beforeId={labelLayer}
            paint={{ 'fill-color': ['get', 'fill'], 'fill-opacity': 0.72 }}
          />
          <Layer
            id="zones-outline"
            type="line"
            beforeId={labelLayer}
            paint={{ 'line-color': theme === 'dark' ? '#a5b3a7' : '#465046', 'line-width': 0.8, 'line-opacity': 0.22 }}
          />
          <Layer
            id="zones-picked"
            type="line"
            beforeId={labelLayer}
            filter={['==', ['get', 'zone'], pickedZone?.zone ?? '']}
            paint={{ 'line-color': theme === 'dark' ? '#7fd1b1' : '#2b6c58', 'line-width': 2.5 }}
          />
        </Source>
      )}
      {VEIL_ENABLED && <TransitionVeilLayer />}
      <NavigationControl position="top-right" showCompass={false} />
      <ScaleControl position="bottom-left" />
      <a className="landsd-logo" href="https://www.landsd.gov.hk" target="_blank" rel="noreferrer">
        <img src={LANDSD_LOGO_URL} alt="Lands Department" />
      </a>
      <DeckOverlay
        layers={layers}
        getTooltip={({ object, coordinate }) =>
          object && ('road_zh' in object || 'detectors' in object) ? trafficTooltip(object, coordinate) : null
        }
      />
      <div ref={tipRef} className="zone-tip" hidden={!hovered}>
        {hovered && (
          <>
            <strong>{hovered.label}</strong>
            <span>
              {text(metric.name)}：
              {(() => {
                const value = metric.value(hovered)
                return value === null ? '—' : text(metric.format(value))
              })()}
            </span>
          </>
        )}
      </div>
      {pickedZone && <ZonePanel zone={pickedZone} onClose={() => setPickedZone(null)} />}
      <div className={`map-legends${legendOpen ? ' is-open' : ''}${pickedZone ? ' has-selection' : ''}`}>
        <button type="button" className="legend-toggle" onClick={() => setLegendOpen(!legendOpen)} aria-expanded={legendOpen} aria-controls="map-legend-body">
          {text('图层与图例')}<span>{text(metric.name)} · {legendOpen ? '−' : '+'}</span>
        </button>
        <div className="legend-body" id="map-legend-body">
        <ZoneLegend
          theme={theme}
          enabled={zonesOn}
          onToggle={setZonesOn}
          metric={metric}
          onMetric={setMetric}
          failed={zonesFailed}
          loading={zonesOn && !zones && !zonesFailed}
          count={zones ? zones.features.length : null}
        />
        <TrafficLegend snapshot={traffic} failed={trafficFailed} enabled={trafficOn} onToggle={setTrafficOn} />
        </div>
      </div>
    </MapGL>
  )
}
