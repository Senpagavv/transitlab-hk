import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'

import { TransitionVeil } from './transitionVeil'

/** Attaches the zoom transition to the surrounding map. Renders nothing itself. */
export default function TransitionVeilLayer() {
  const { current } = useMap()

  useEffect(() => {
    if (!current) return
    const veil = new TransitionVeil(current.getMap())
    if (import.meta.env.DEV) Object.assign(window, { __veil: veil }) // for scripts/check-transition.mjs
    return () => veil.destroy()
  }, [current])

  return null
}
