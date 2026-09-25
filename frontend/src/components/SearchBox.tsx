import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'

import { searchPlaces, suggestPlaces, type Place, type PlaceKind } from '../api/client'

interface SearchBoxProps {
  onSelect: (place: Place) => void
  /** The box was emptied: the map drops its marker. */
  onClear: () => void
}

const KIND_LABEL: Record<PlaceKind, string> = {
  mtr: '港铁站',
  light_rail: '轻铁站',
  ferry: '码头',
  bus_stop: '巴士站',
  minibus_stop: '小巴站',
  place: '地点',
}

// Local suggestions are instant; the government API takes ~1–2 s, so wait until typing pauses.
const LOCAL_DELAY_MS = 80
const REMOTE_DELAY_MS = 400
const MAX_ITEMS = 10

/** A single Chinese character or 1–2 Latin letters give the government API too little to go on. */
function worthRemoteSearch(q: string) {
  return /^[\x20-\x7e]+$/.test(q) ? q.length >= 3 : q.length >= 2
}

function mergePlaces(local: Place[], remote: Place[]) {
  const seen = new Set(local.map((p) => p.name_zh))
  return [...local, ...remote.filter((p) => !seen.has(p.name_zh))].slice(0, MAX_ITEMS)
}

function subtitle(p: Place) {
  return p.kind === 'place' ? [p.district_zh, p.address_zh].filter(Boolean).join(' ') : p.name_en
}

export default function SearchBox({ onSelect, onClear }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<Place[]>([])
  const [remote, setRemote] = useState<Place[]>([])
  const [localLoading, setLocalLoading] = useState(false)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pickedNameRef = useRef<string | null>(null)

  const items = useMemo(() => mergePlaces(local, remote), [local, remote])
  const q = query.trim()

  // Fetch suggestions whenever the text changes (skipped right after picking a result).
  useEffect(() => {
    if (!q || q === pickedNameRef.current) return
    const controller = new AbortController()
    const isCurrent = () => !controller.signal.aborted

    const localTimer = setTimeout(() => {
      suggestPlaces(q, controller.signal)
        .then((places) => isCurrent() && setLocal(places))
        .catch(() => isCurrent() && setLocal([]))
        .finally(() => isCurrent() && setLocalLoading(false))
    }, LOCAL_DELAY_MS)

    const remoteTimer = setTimeout(() => {
      if (!worthRemoteSearch(q)) return
      setRemoteLoading(true)
      searchPlaces(q, controller.signal)
        .then((places) => isCurrent() && setRemote(places))
        .catch(() => isCurrent() && setRemote([]))
        .finally(() => isCurrent() && setRemoteLoading(false))
    }, REMOTE_DELAY_MS)

    return () => {
      controller.abort()
      clearTimeout(localTimer)
      clearTimeout(remoteTimer)
    }
  }, [q])

  // Close when clicking anywhere outside the search box.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    setQuery(text)
    pickedNameRef.current = null
    setActiveIndex(-1)
    if (!text.trim()) {
      // Keep the old rows so the list can fade out instead of collapsing instantly.
      setOpen(false)
      onClear()
      return
    }
    setRemote([]) // remote rows belong to the previous text
    setLocalLoading(true)
    setRemoteLoading(worthRemoteSearch(text.trim()))
    setOpen(true)
  }

  function pick(place: Place) {
    pickedNameRef.current = place.name_zh
    setQuery(place.name_zh)
    setOpen(false)
    onSelect(place)
    inputRef.current?.blur()
  }

  function clear() {
    setQuery('')
    setOpen(false)
    setLocal([])
    setRemote([])
    setLocalLoading(false)
    setRemoteLoading(false)
    pickedNameRef.current = null
    onClear()
    // Focus after the re-render: focusing now would run onFocus with the old text and reopen the
    // list with the old results.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault()
      setOpen(true)
      setActiveIndex((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1))
    } else if (e.key === 'Enter' && open && items.length) {
      e.preventDefault()
      pick(items[Math.max(activeIndex, 0)])
    }
  }

  const showEmpty = !localLoading && !remoteLoading && items.length === 0

  return (
    <div className="search" ref={containerRef}>
      <div className="search-input">
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => q && q !== pickedNameRef.current && setOpen(true)}
          placeholder="输入地点或车站，例如：九龙塘、古洞、沙田"
          role="combobox"
          aria-expanded={open}
          aria-controls="search-listbox"
          aria-activedescendant={activeIndex >= 0 ? `search-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
        />
        {query && (
          <button type="button" className="search-clear" onClick={clear} aria-label="清除">
            ×
          </button>
        )}
      </div>

      <div className={`search-dropdown${open ? ' open' : ''}`} aria-hidden={!open}>
        <ul id="search-listbox" role="listbox">
          {items.map((p, i) => (
            <li
              key={`${p.kind}-${p.name_zh}-${p.lon}`}
              id={`search-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={i === activeIndex ? 'active' : undefined}
              onPointerDown={(e) => e.preventDefault()} // keep input focus until click completes
              onClick={() => pick(p)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className={`kind kind-${p.kind}`}>{KIND_LABEL[p.kind]}</span>
              <span className="option-text">
                <strong>{p.name_zh || p.name_en}</strong>
                {subtitle(p) && <small>{subtitle(p)}</small>}
              </span>
            </li>
          ))}
        </ul>
        {remoteLoading && <div className="search-status">正在搜索更多地点…</div>}
        {showEmpty && <div className="search-status">没有找到相关地点</div>}
      </div>
    </div>
  )
}
