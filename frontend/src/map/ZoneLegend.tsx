import { ZONE_METRICS, type ZoneMetric } from './zones'

interface ZoneLegendProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  metric: ZoneMetric
  onMetric: (metric: ZoneMetric) => void
  failed: boolean
  loading: boolean
  count: number | null
}

export default function ZoneLegend({ enabled, onToggle, metric, onMetric, failed, loading, count }: ZoneLegendProps) {
  return (
    <div className="map-legend zone-legend">
      <label className="map-legend-title">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        交通分区数据
        {count !== null && <span className="legend-count">{count} 个</span>}
      </label>

      {enabled && (
        <>
          <select
            id="zone-metric"
            className="zone-metric"
            value={metric.id}
            onChange={(e) => onMetric(ZONE_METRICS.find((m) => m.id === e.target.value) ?? ZONE_METRICS[0])}
          >
            {ZONE_METRICS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <p className="zone-unit">{metric.unit}</p>
          <ul className="zone-classes">
            {metric.classes.map((c) => (
              <li key={c.label}>
                <span className="zone-swatch" style={{ background: `rgb(${c.color.join(',')})` }} />
                {c.label}
              </li>
            ))}
          </ul>
          <p className="map-legend-note">
            {failed && <span className="traffic-error">交通分区数据读取失败</span>}
            {!failed && loading && '读取中…'}
            {!failed && !loading && (
              <>
                {metric.note}
                <br />
                点击分区查看详细数字
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}
