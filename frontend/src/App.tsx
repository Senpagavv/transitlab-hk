import { useState } from 'react'
import type { Place } from './api/client'
import SearchBox from './components/SearchBox'
import MapCanvas from './map/MapCanvas'
import { text, usePresentation } from './i18n'
import './App.css'

export default function App() {
  const [selected, setSelected] = useState<Place | null>(null)
  const { theme } = usePresentation()

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/logo-tide.svg" width="24" height="24" alt="" />
          <div className="brand-copy">
            <span className="brand-wordmark">TransitLab</span>
            <span className="brand-sub">HK · {text('全港数据地图')}</span>
          </div>
        </div>
        <SearchBox onSelect={setSelected} onClear={() => setSelected(null)} />
        <a className="hub-link" href="/feeder/index.html#hub=1&nav=5">← {text('五个模式')}</a>
      </header>
      <main className="map-area" aria-label={text('全港数据地图')}>
        <MapCanvas selected={selected} theme={theme} />
      </main>
    </div>
  )
}
