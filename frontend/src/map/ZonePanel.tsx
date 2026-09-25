import type { ZoneProps } from './zones'

interface ZonePanelProps {
  zone: ZoneProps
  onClose: () => void
}

// Where each figure comes from, so a reader can tell a count from an estimate.
type Basis = '实测' | '推算' | '估算'

const n = (v: number) => Math.round(v).toLocaleString('zh-CN')
const m2 = (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(v >= 1e6 ? 0 : 1)} 万 m²` : `${n(v)} m²`)

function Row({ name, value, basis, sub }: { name: string; value: string; basis: Basis; sub?: string }) {
  return (
    <div className="zone-row">
      <dt>{name}</dt>
      <dd>
        <span className="zone-value">{value}</span>
        {sub && <span className="zone-sub">{sub}</span>}
        <span className={`basis basis-${basis}`}>{basis}</span>
      </dd>
    </div>
  )
}

export default function ZonePanel({ zone, onClose }: ZonePanelProps) {
  const growth =
    zone.growth_pct === null ? undefined : `2021 年 ${n(zone.population_2021)}，${zone.growth_pct > 0 ? '+' : ''}${zone.growth_pct}%`

  return (
    <aside className="zone-panel" aria-label={`${zone.label} 交通分区数据`}>
      <header className="zone-panel-head">
        <div>
          <h2>{zone.label}</h2>
          <p>
            {zone.district} · 交通分区 {zone.zone} · {zone.area_km2} km²
          </p>
        </div>
        <button type="button" className="zone-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>

      {!zone.road_access && <p className="zone-flag">没有公路连接，进出靠渡轮或步行</p>}

      <section>
        <h3>住在这里的人（2026 年）</h3>
        <dl>
          <Row name="人口" value={n(zone.population)} basis="推算" sub={growth} />
          <Row name="住户" value={n(zone.households)} basis="推算" />
          <Row name="工作人口" value={n(zone.workers)} basis="推算" />
          <Row name="学生" value={n(zone.students)} basis="推算" />
          {zone.elderly_pct !== null && <Row name="65 岁以上" value={`${zone.elderly_pct}%`} basis="推算" />}
          {zone.density !== null && <Row name="人口密度" value={`${n(zone.density)} 人/km²`} basis="推算" />}
        </dl>
      </section>

      <section>
        <h3>吸引出行的地方</h3>
        <dl>
          <Row name="写字楼楼面" value={m2(zone.floor_office_m2)} basis="估算" />
          <Row name="零售楼面" value={m2(zone.floor_retail_m2)} basis="估算" />
          <Row name="工业楼面" value={m2(zone.floor_industrial_m2)} basis="估算" />
          <Row name="中小学及幼稚园学额" value={n(zone.school_places)} basis="估算" />
          {zone.tertiary_places > 0 && <Row name="专上学额" value={n(zone.tertiary_places)} basis="估算" />}
          {zone.hospital_m2 > 0 && <Row name="医院楼面" value={m2(zone.hospital_m2)} basis="估算" />}
        </dl>
      </section>

      <section>
        <h3>工作日出行（2026 年，坐车或开车）</h3>
        <dl>
          <Row name="岗位" value={n(zone.jobs)} basis="估算" />
          <Row name="从这里出发" value={`${n(zone.trips_out)} 人次`} basis="估算" />
          <Row name="到这里来" value={`${n(zone.trips_in)} 人次`} basis="估算" />
          {zone.trips_crossing >= 100 && <Row name="跨境往来" value={`${n(zone.trips_crossing)} 人次`} basis="估算" />}
        </dl>
      </section>

      <p className="zone-foot">
        推算：全港及各年龄段总数对齐统计处 2026 年中估计（临时数），各分区分布依规划署 2023–2031 人口分布推算。
        估算：由建筑物高度、占地、屋宇署用途及教育局数据计算，总量已对上官方数字，但分区内的分配是模型做的。
        出行：各区出行率与吸引量取运输署出行调查 2022，不含全程步行和单车；跨境取入境处与教育局数字。
      </p>
    </aside>
  )
}
