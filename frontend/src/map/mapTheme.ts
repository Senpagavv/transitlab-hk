import type { StyleSpecification } from 'maplibre-gl'
import type { Theme } from '../i18n'

/** Only presentation properties change. Sources, geometry, labels, filters and zoom ranges stay intact. */
export function styleForTheme(style: StyleSpecification, theme: Theme): StyleSpecification {
  const dark = theme === 'dark'
  const p = dark
    ? { sea: '#1d2a31', land: '#262624', road: '#5b5348', minor: '#463f37', edge: '#4d554f', ink: '#d8ddd8', grey: '#a2aba6' }
    : { sea: '#d9e8ef', land: '#f7f5ef', road: '#e2c48f', minor: '#e9dcc3', edge: '#aeb6ad', ink: '#333b36', grey: '#6d766f' }
  return {
    ...style,
    layers: style.layers.map(layer => {
      const copy = { ...layer, paint: { ...layer.paint } } as typeof layer
      // The old raster preview is baked in the previous colours; let the new sea show during tile loading.
      if (copy.type === 'raster') copy.paint = { ...copy.paint, 'raster-opacity': 0 }
      if (copy.type === 'background') copy.paint = { ...copy.paint, 'background-color': p.sea }
      if (!('source' in copy)) return copy
      const id = copy.id
      const water = /Hydro|HYDR|Reservoir|Water|SPL|SWP|FOU/i.test(id) && !/LAF|BRE; DAM/i.test(id)
      const road = /Road|TSPT|TransLine|PedNBike|PedLine/i.test(id)
      const major = /Expressway|MainRoad|Major|Trunk/i.test(id)
      if (copy.type === 'fill') {
        const paint = { ...copy.paint }
        delete paint['fill-pattern']
        paint['fill-color'] = water ? p.sea : road ? (major ? p.road : p.minor) : p.land
        if ('fill-outline-color' in paint) paint['fill-outline-color'] = p.edge
        copy.paint = paint
      }
      if (copy.type === 'line') {
        copy.paint = { ...copy.paint, 'line-color': water ? p.edge : road ? p.road : p.edge }
        // Boundary lines stay fine and quiet; traffic widths are controlled separately in liveTraffic.ts.
        if (/BDRY|Boundary/i.test(id)) copy.paint['line-color'] = dark ? 'rgba(255,255,255,.22)' : 'rgba(70,80,70,.38)'
      }
      if (copy.type === 'symbol') {
        copy.paint = { ...copy.paint, 'text-color': /Road|Street|SiteName|PlaceName/i.test(id) ? p.ink : p.grey, 'text-halo-color': p.land }
      }
      return copy
    }),
  }
}
