import { useState } from 'react'

import type { Place } from './api/client'
import SearchBox from './components/SearchBox'
import MapCanvas from './map/MapCanvas'
import './App.css'

// The Hong Kong data map (the game's «全港數據地圖», 2026-10-15): zones, live traffic and search only. The fleet
// sandbox (FleetPanel) and the driverless-fleet scenario (DeploymentPanel) are off the page; their files stay for now.
export default function App() {
  const [selected, setSelected] = useState<Place | null>(null)

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">TransitLab HK</span>
        <SearchBox onSelect={setSelected} onClear={() => setSelected(null)} />
      </header>
      <main className="map-area">
        <MapCanvas selected={selected} />
      </main>
    </div>
  )
}
