import { useState } from 'react'

import type { Place } from './api/client'
import SearchBox from './components/SearchBox'
import MapCanvas from './map/MapCanvas'
import FleetPanel from './components/FleetPanel'
import DeploymentPanel from './components/DeploymentPanel'
import './App.css'

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
        <FleetPanel />
        <DeploymentPanel />
      </main>
    </div>
  )
}
