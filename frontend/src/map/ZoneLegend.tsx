import { text, type Theme } from '../i18n'
import { ZONE_METRICS, themeColor, type ZoneMetric } from './zones'

interface ZoneLegendProps {
  theme: Theme
  enabled: boolean
  onToggle: (enabled: boolean) => void
  metric: ZoneMetric
  onMetric: (metric: ZoneMetric) => void
  failed: boolean
  loading: boolean
  count: number | null
}

export default function ZoneLegend({ theme, enabled, onToggle, metric, onMetric, failed, loading, count }: ZoneLegendProps) {
  return (
    <div className="map-legend zone-legend">
      <label className="map-legend-title">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        {text('交通分区数据')}
        {count !== null && <span className="legend-count">{count} {text('个')}</span>}
      </label>

      {enabled && (
        <>
          <select
            id="zone-metric"
            aria-label={text('分区指标')}
            className="zone-metric"
            value={metric.id}
            onChange={(e) => onMetric(ZONE_METRICS.find((m) => m.id === e.target.value) ?? ZONE_METRICS[0])}
          >
            {ZONE_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {text(m.name)}
              </option>
            ))}
          </select>
          <p className="zone-unit">{text(metric.unit)}</p>
          <ul className="zone-classes">
            {metric.classes.map((c) => (
              <li key={text(c.label)}>
                <span className="zone-swatch" style={{ background: `rgb(${themeColor(c.color, theme).join(',')})` }} />
                {c.label}
              </li>
            ))}
          </ul>
          <p className="map-legend-note">
            {failed && <span className="traffic-error">{text('交通分区数据读取失败')}</span>}
            {!failed && loading && text('读取中…')}
            {!failed && !loading && (
              <>
                {text(metric.note)}
                <br />
                {text('点击分区查看详细数字')}
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}
