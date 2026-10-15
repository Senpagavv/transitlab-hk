import { useSyncExternalStore } from 'react'
import traditional from './zh-Hant.json'

export type Theme = 'light' | 'dark'

function saved(key: string) {
  try { return localStorage.getItem(key) } catch { return null }
}

// English currently falls back to the game's default Traditional Chinese. Data names are never converted.
function language() { return saved('tl-lang') === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant' }

function syncPreferences() {
  document.documentElement.lang = language()
  document.title = text('TransitLab HK · 全港数据地图')
  const theme = saved('tl-theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#0A0A0A' : '#FFFCF7')
}
syncPreferences()

function subscribe(notify: () => void) {
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'lang'] })
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === 'tl-lang' || event.key === 'tl-theme') { syncPreferences(); notify() }
  }
  window.addEventListener('storage', onStorage)
  return () => { observer.disconnect(); window.removeEventListener('storage', onStorage) }
}

export function usePresentation() {
  const value = useSyncExternalStore(subscribe, () => `${language()}:${document.documentElement.dataset.theme}`)
  return { language: value.split(':')[0], theme: (value.endsWith(':dark') ? 'dark' : 'light') as Theme }
}

// A small, UI-only character table generated from the existing labels. Do not pass data-provided place names here.
export function text(value: string): string {
  if (language() === 'zh-Hans') return value
  return value.replace(/[\u3400-\u9fff]/g, char => (traditional as Record<string, string>)[char] ?? char)
}
