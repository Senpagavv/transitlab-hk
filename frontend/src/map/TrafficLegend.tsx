import { congestionColor, type LiveTrafficSnapshot } from './liveTraffic'

interface TrafficLegendProps {
  snapshot: LiveTrafficSnapshot | null
  failed: boolean
  enabled: boolean
  onToggle: (enabled: boolean) => void
}

const STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9]

/** Time of the reading, e.g. "2026-09-16T12:51:00" -> "12:51". */
function readingTime(observedAt: string) {
  return observedAt.slice(11, 16)
}

export default function TrafficLegend({ snapshot, failed, enabled, onToggle }: TrafficLegendProps) {
  return (
    <div className="map-legend traffic-legend">
      <label className="map-legend-title">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
        实时车流
      </label>

      {enabled && (
        <>
          <div className="traffic-ramp" aria-hidden="true">
            {STOPS.map((stop) => (
              <span key={stop} style={{ background: `rgb(${congestionColor(stop).join(',')})` }} />
            ))}
          </div>
          <div className="traffic-scale">
            <span>畅通</span>
            <span>拥堵</span>
          </div>
          <p className="map-legend-note">
            线越粗表示车流越多；两个方向各靠行车方向左侧
            <br />
            探测器只设在主干道，线条连接相邻探测器，其间颜色为插值
            <br />
            没有线条的路段是那里没有探测器，或那段路上只有一个、连不成线
            <br />
            {failed && <span className="traffic-error">暂时取不到数据</span>}
            {!failed && snapshot && (
              <>
                数据时间 {readingTime(snapshot.observed_at)} · {snapshot.detectors.length} 个探测器
                <br />
                来源：运输署主要道路交通数据（每 3 分钟更新）
              </>
            )}
            {!failed && !snapshot && '读取中…'}
          </p>
        </>
      )}
    </div>
  )
}
