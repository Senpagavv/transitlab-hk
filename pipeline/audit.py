"""Check every dataset the model will be built on, in one command.

    uv run python pipeline/audit.py

Run this after changing any pipeline, and before running the model. It fails loudly rather than
letting a broken join or a missing figure turn into a wrong answer three steps later - a zone code
that silently stops matching would not raise an error anywhere, it would just quietly drop a
district's population out of the model.

The checks are the ones in docs/data-audit-checklist.md, applied across datasets rather than within
one: totals against official figures, spatial coverage, missing-value meaning, granularity, geometry,
outliers, and whether the two sides of the model still agree with each other.
"""

import json
import subprocess
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "data" / "web"
MODEL = ROOT / "data" / "model"

# Zone layers that must all describe the same zones, or every join between them is wrong.
ZONE_LAYERS = ["zones", "zones-attraction", "zones-schools", "zones-institutions"]
# The census zones the model zones were split out of; their totals must survive the split.
CENSUS_LAYER = "zones-census"
# Fields the model divides by. A zero or a blank here is a crash or a silent infinity.
DENOMINATORS = ["household_size", "area_km2", "households", "population", "workers", "students"]

OFFICIAL = {
    "population": (7_413_070, 0.01),   # 2021 Population Census, total population
    "households": (2_674_140, 0.02),   # 2021 Population Census, domestic households
}
SURVEY_TRIPS = 12_363_000  # TCS 2022, weekday mechanised trips (Table 3.3)
TRIPS_TOLERANCE = 0.05  # the 2026 total may move this far from the survey year's
# A zone whose typical public transport trip takes longer than this is reached through a stop with
# no service in the modelled hour, or not at all (Tsang Tsui's centre once sat by an hourly bus that
# starts at 9 a.m., and its trips took a median 185 minutes).
TRANSIT_MEDIAN_MAX_MIN = 150

passed: list[str] = []
failed: list[str] = []


def check(condition: bool, message: str) -> None:
    (passed if condition else failed).append(message)


def load(name: str) -> gpd.GeoDataFrame | None:
    path = WEB / f"{name}.geojson"
    return gpd.read_file(path) if path.exists() else None


def check_joins() -> dict[str, gpd.GeoDataFrame]:
    layers = {name: load(name) for name in ZONE_LAYERS}
    present = {name: frame for name, frame in layers.items() if frame is not None}
    missing = [name for name, frame in layers.items() if frame is None]
    check(not missing, f"所有小区图层齐备（缺：{missing}）" if missing else "所有小区图层齐备")

    if not present:
        return {}
    reference = set(next(iter(present.values()))["zone"])
    for name, frame in present.items():
        check(set(frame["zone"]) == reference, f"{name}：小区编号与基准一致")
        check(frame["zone"].is_unique, f"{name}：小区编号无重复")
        check(bool(frame.geometry.is_valid.all()), f"{name}：几何全部有效")
        check(not bool(frame.geometry.is_empty.any()), f"{name}：无空几何")
        check(str(frame.crs) == "EPSG:4326", f"{name}：坐标系为 WGS84")
    return present


def check_denominators(zones: gpd.GeoDataFrame) -> None:
    for field in DENOMINATORS:
        if field not in zones:
            continue
        column = pd.to_numeric(zones[field], errors="coerce")
        check(not column.isna().any(), f"{field}：无空值")
        check(bool((column > 0).all()), f"{field}：无零值（除零风险）")


def check_official(zones: gpd.GeoDataFrame) -> None:
    for field, (official, tolerance) in OFFICIAL.items():
        if field not in zones:
            continue
        ours = float(pd.to_numeric(zones[field], errors="coerce").sum())
        gap = abs(ours - official) / official
        check(gap <= tolerance,
              f"{field} 合计 {ours:,.0f} vs 官方 {official:,.0f}（差 {gap:.2%}，容许 {tolerance:.0%}）")


def check_trip_ends(zones: gpd.GeoDataFrame | None) -> None:
    """Step 1's output: complete, balanced, and still the size of Hong Kong's travel."""
    path = MODEL / "trip-ends-2026.parquet"
    if not path.exists():
        check(False, "出行生成结果存在（pipeline/21）")
        return
    table = pd.read_parquet(path)
    internal = table[~table["external"]]
    check(zones is None or set(internal["zone"]) == set(zones["zone"]),
          f"出行生成覆盖全部小区（{len(internal)} 个）另有外部小区 {int(table['external'].sum())} 个")
    ends = [c for c in table.columns if c[:2] in ("P_", "A_")]
    values = table[ends]
    check(not values.isna().any().any() and bool((values >= 0).all().all()), "出行端点：无空值、无负值")
    purposes = sorted({c[2:] for c in ends})
    unbalanced = [p for p in purposes
                  if abs(table[f"P_{p}"].sum() - table[f"A_{p}"].sum()) > 1e-3 * max(table[f"P_{p}"].sum(), 1)]
    check(not unbalanced, f"各出行目的产生 = 吸引（{', '.join(purposes)}）" + (f"；不平：{unbalanced}" if unbalanced else ""))
    mechanised = sum(table[f"P_{p}"].sum() for p in ("HBW", "HBS", "HBO", "NHB"))
    gap = mechanised / SURVEY_TRIPS - 1
    check(abs(gap) <= TRIPS_TOLERANCE,
          f"2026 机动化出行 {mechanised:,.0f} vs 调查 2022 {SURVEY_TRIPS:,.0f}（{gap:+.1%}，容许 ±{TRIPS_TOLERANCE:.0%}）")
    crossing_path = WEB / "cross-boundary.json"
    if crossing_path.exists():
        published = json.loads(crossing_path.read_text(encoding="utf-8"))["weekday_crossings"]
        ours = sum(table[f"P_{p}"].sum() for p in ("CBS", "CBR", "CBV"))
        check(abs(ours - published) / published < 0.001,
              f"跨境出行 {ours:,.0f} 与入境处工作日过境 {published:,.0f} 一致（另含统计之外的学童）")


def check_distribution() -> None:
    """Step 2's matrices must send and receive exactly the trips step 1 produced and attracted."""
    path, ends_path = MODEL / "trip-distribution-2026.npz", MODEL / "trip-ends-2026.parquet"
    if not path.exists() or not ends_path.exists():
        check(False, "出行分布结果存在（pipeline/22）")
        return
    matrices = np.load(path, allow_pickle=True)
    ends = pd.read_parquet(ends_path).set_index("zone").reindex([str(z) for z in matrices["zones"]])
    check(not ends.index.isna().any() and not ends["P_HBW"].isna().any(), "出行分布的小区与出行生成一致")
    gaps = {}
    for key in matrices.files:
        if not key.startswith("T_"):
            continue
        purpose, trips = key[2:], matrices[key].astype(float)
        row = np.abs(trips.sum(axis=1) - ends[f"P_{purpose}"].to_numpy()).max()
        gaps[purpose] = row
        if purpose in ("HBW", "HBS", "HBO", "NHB"):  # doubly constrained: columns too
            gaps[purpose] = max(row, np.abs(trips.sum(axis=0) - ends[f"A_{purpose}"].to_numpy()).max())
    worst = max(gaps, key=gaps.get)
    check(gaps[worst] < 50, f"出行分布逐小区守恒：最大偏差 {gaps[worst]:.1f} 人次（{worst}；容许 50）")


def check_mode_split() -> None:
    """Step 3 may move trips between modes but never create or lose any."""
    path, distribution_path = MODEL / "mode-split-2026.npz", MODEL / "trip-distribution-2026.npz"
    if not path.exists() or not distribution_path.exists():
        check(False, "方式划分结果存在（pipeline/23）")
        return
    modes, distribution = np.load(path, allow_pickle=True), np.load(distribution_path, allow_pickle=True)
    check(list(modes["zones"]) == list(distribution["zones"]), "方式划分与出行分布的小区一致")
    worst, where = 0.0, ""
    for key in distribution.files:
        if not key.startswith("T_"):
            continue
        purpose = key[2:]
        parts = [modes[k].astype(float) for k in modes.files if k.startswith(f"T_{purpose}_")]
        gap = float(np.abs(sum(parts) - distribution[key].astype(float)).max()) if parts else float("inf")
        if gap > worst:
            worst, where = gap, purpose
    check(worst < 1.0, f"方式划分逐格守恒：各方式相加等于分布矩阵，最大偏差 {worst:.3f} 人次" + (f"（{where}）" if where else ""))


def check_centres(zones: gpd.GeoDataFrame | None) -> None:
    """Every mode's trips start at the zone centres; each must lie inside its own zone."""
    path = MODEL / "zone-centres.parquet"
    if zones is None or not path.exists():
        return
    centres = pd.read_parquet(path).set_index("zone").reindex(zones["zone"])
    check(not centres["x"].isna().any(), "每个小区都有中心点")
    points = gpd.GeoSeries(gpd.points_from_xy(centres["x"], centres["y"]), crs="EPSG:2326")
    inside = points.within(zones.to_crs("EPSG:2326").geometry.buffer(1), align=False)
    check(bool(inside.all()), "小区中心全部落在所属小区内"
          + ("" if inside.all() else f"（例外：{list(zones.loc[~inside.to_numpy(), 'zone'])[:5]}）"))


def check_skims() -> None:
    """The matrices must be in the land-use table's zone order, and no zone may be cut off."""
    landuse_path = MODEL / "landuse-2026.parquet"
    if not landuse_path.exists():
        return
    order = pd.read_parquet(landuse_path)["zone"].astype(str).tolist()
    for name in ("skim-car-freeflow", "skim-active-transit"):
        path = MODEL / f"{name}.npz"
        if not path.exists():
            check(False, f"{name} 存在")
            continue
        skim = np.load(path, allow_pickle=True)
        check([str(z) for z in skim["zones"]] == order, f"{name}：小区编号与顺序与土地利用表一致")
    transit_path = MODEL / "skim-active-transit.npz"
    if transit_path.exists():
        transit = np.load(transit_path, allow_pickle=True)["transit_min"].astype(float)
        if transit.shape == (len(order), len(order)):
            masked = np.where(np.isfinite(transit), transit, np.nan)
            np.fill_diagonal(masked, np.nan)
            out, into = np.nanmedian(masked, axis=1), np.nanmedian(masked, axis=0)
            slow = {order[i]: round(float(max(out[i], into[i]))) for i in range(len(order))
                    if max(out[i], into[i]) > TRANSIT_MEDIAN_MAX_MIN}
            check(not slow, f"公交：没有小区的出发或到达中位时间超过 {TRANSIT_MEDIAN_MAX_MIN} 分钟"
                  + (f"（超出：{slow}）" if slow else f"（最慢 {np.nanmax(np.maximum(out, into)):.0f} 分钟）"))


def check_audit_files() -> None:
    """Every pipeline writes its own audit; none of them may be reporting a value out of range."""
    for path in sorted(WEB.glob("*-audit.json")):
        report = json.loads(path.read_text(encoding="utf-8")).get("report", [])
        flagged = [line for line in report if "需复核" in line or "超出范围" in line]
        check(not flagged, f"{path.name}：无超范围项" + (f" → {flagged}" if flagged else ""))


def check_cross_boundary() -> None:
    path = WEB / "cross-boundary.json"
    if not path.exists():
        check(False, "跨境口岸数据存在")
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    points = data["control_points"]
    check(bool(points), "跨境口岸数据存在")
    check(all(p["zone"] for p in points), "每个口岸都挂接到了小区")
    busy = [p for p in points if p["weekday_arrivals"] + p["weekday_departures"] > 0]
    check(len(busy) >= 8, f"有流量的口岸 {len(busy)} 个（应 ≥ 8）")
    check(data["weekday_crossings"] > 100_000,
          f"典型工作日跨境人次 {data['weekday_crossings']:,.0f}")


def check_traffic_counts() -> None:
    path = WEB / "traffic" / "atc-stations.json"
    if not path.exists():
        check(False, "周年交通普查数据存在")
        return
    records = json.loads(path.read_text(encoding="utf-8"))["records"]
    located = [r for r in records if "lon" in r]
    flows = [r["aadt"] for r in records if r.get("aadt")]
    check(len(records) > 2000, f"普查记录 {len(records):,} 条")
    check(len(located) / len(records) > 0.95, f"带坐标的记录占 {len(located) / len(records):.1%}")
    check(all(f > 0 for f in flows), "无非正的日均车流量")
    check(max(flows) < 500_000, f"最大日均车流量 {max(flows):,}（无不可能值）")


def check_split() -> None:
    """The split into model zones must not have created or lost anyone."""
    census, model = load(CENSUS_LAYER), load("zones")
    if census is None or model is None:
        return
    for field in ("population", "households", "workers", "students"):
        if field in census and field in model:
            check(int(census[field].sum()) == int(model[field].sum()),
                  f"细分守恒 {field}：普查 {census[field].sum():,.0f} == 模型 {model[field].sum():,.0f}")
    check(set(model["census_zone"]) == set(census["zone"]), "细分后每个普查小区都有对应模型小区")
    check(int(model["population"].max()) < 60_000,
          f"最大小区人口 {model['population'].max():,.0f}（应 < 60,000）")
    anchors = gpd.GeoSeries(
        gpd.points_from_xy(model["centroid_lon"], model["centroid_lat"]), crs="EPSG:4326"
    ).to_crs("EPSG:2326")
    check(bool(anchors.within(model.to_crs("EPSG:2326").geometry).all()), "接驳形心全部落在所属小区内")


def check_road_network() -> None:
    """A network that is not strongly connected silently makes destinations unreachable."""
    model = ROOT / "data" / "model"
    if not (model / "road-links.parquet").exists():
        return
    links = pd.read_parquet(model / "road-links.parquet")
    connectors = pd.read_parquet(model / "road-connectors.parquet")
    audit = json.loads((WEB / "road-network-audit.json").read_text(encoding="utf-8"))
    zones = load("zones")

    check(audit["largest_component_share"] >= 0.90,
          f"路网强连通：最大分量占 {audit['largest_component_share']:.1%}（应 ≥ 90%）")
    # Cheung Chau, Peng Chau and Lamma have no road to anywhere; they must be named, not joined.
    isolated = set(audit.get("road_isolated_zones", []))
    covered = set(connectors["zone"]) | isolated
    check(zones is None or covered == set(zones["zone"]),
          f"每个小区要么有接驳点，要么列为无公路小区（{connectors['zone'].nunique()} 有接驳 + "
          f"{len(isolated)} 无公路 = {len(covered)}/{len(zones) if zones is not None else '?'}）")
    check(len(isolated) <= 10, f"无公路小区 {len(isolated)} 个（{', '.join(sorted(isolated))}）；过多说明接驳逻辑出错")
    check(bool((links["length_m"] > 0).all()), "无零长度路段")
    check(bool((links["capacity_ab_veh_hr"] > 0).all()), "无零通行能力路段（顺向）")
    two_way = links["direction"].eq(0)
    check(bool((links.loc[two_way, "capacity_ba_veh_hr"] > 0).all()), "双向路段的反向也有通行能力")
    check(bool(links["lanes_ab"].between(1, 8).all()), "每段路的车道数在 1-8 之间")
    osm_share = float(links.loc[links["lanes_source"].str.startswith("osm"), "length_m"].sum() / links["length_m"].sum())
    check(osm_share >= 0.8, f"车道与道路等级来自 OpenStreetMap 的路网长度 {osm_share:.1%}（应 ≥ 80%）")
    check(bool((links["free_flow_min"] > 0).all()), "无零自由流时间（除零风险）")
    routing = links[links["routable"]] if "routable" in links else links
    check(bool(routing["a_node"].ne(routing["b_node"]).all()), "路由图内无自环路段")
    check(int((links["toll_hkd"] > 0).sum()) >= 8,
          f"收费点 {int((links['toll_hkd'] > 0).sum())} 个（香港有 8 条收费隧道/管制区）")
    # 不可通行区域：分区接到路网、接到车站，都不能隔着海或水塘（pipeline/15、39 用规划署 10 米土地用途格网查）
    water = audit.get("connector_water_check") or {}
    stuck = water.get("zones_without_dry_connector", ["?"])
    check(bool(water.get("grid")) and not stuck,
          f"路网接驳不跨海/水塘：跳过跨水候选 {water.get('candidates_skipped', '?')} 个，只能跨水接驳的小区 {len(stuck)} 个{('（' + ', '.join(stuck) + '）') if stuck else ''}")
    transit = WEB / "transit-assignment-audit.json"
    if transit.exists():
        tw = json.loads(transit.read_text(encoding="utf-8")).get("connector_water_check") or {}
        check(bool(tw) and tw.get("limit_m") == 30,
              f"公交接驳按同一标准删掉跨水的（跨水超过 30 米）：{tw.get('dropped', '?')} / {tw.get('connectors', '?')} 条"
              if tw else "公交接驳的跨水检查没有记录（重跑 pipeline/39）")


def check_landuse() -> None:
    """The 2026 land-use table is what trip generation reads; it must be complete."""
    path = ROOT / "data" / "model" / "landuse-2026.parquet"
    if not path.exists():
        check(False, "2026 土地利用表存在")
        return
    table = pd.read_parquet(path)
    zones = load("zones")
    check(zones is None or set(table["zone"]) == set(zones["zone"]),
          f"2026 土地利用表覆盖全部小区（{len(table)} 行）")
    for field in ("population", "households", "workers", "students"):
        check(not table[field].isna().any() and bool((table[field] >= 0).all()),
              f"2026 {field}：无空值、无负值")
    check(not table["district"].isna().any(), "每个小区都有所属行政区")


def check_documents() -> None:
    """The figures the documents quote must be the ones the audits hold (pipeline/check_docs.py).

    A wrong number in a document looks exactly like a right one, so nobody finds it by reading. It
    runs here because the documents are what other people see, and they go stale the moment the model
    is rerun - which is most days.
    """
    script = ROOT / "pipeline" / "check_docs.py"
    if not script.exists():
        check(False, "文档数字体检脚本存在")
        return
    done = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, encoding="utf-8")
    trouble = [line.strip()[2:].strip() for line in (done.stdout or "").splitlines() if line.strip().startswith("←")]
    check(done.returncode == 0, "文档引用的数字与当前审计一致"
          + (f" → {trouble[:3]}" if trouble else ""))


def main() -> None:
    layers = check_joins()
    check_landuse()
    check_road_network()
    check_split()
    zones = layers.get("zones")
    if zones is not None:
        check_denominators(zones)
        check_official(zones)
    check_trip_ends(zones)
    check_distribution()
    check_mode_split()
    check_centres(zones)
    check_skims()
    check_audit_files()
    check_cross_boundary()
    check_traffic_counts()
    check_documents()

    for message in passed:
        print(f"  [OK]   {message}")
    for message in failed:
        print(f"  [FAIL] {message}")
    print(f"\n{len(passed)} 项通过，{len(failed)} 项未通过")
    if failed:
        print("模型不应在未通过项上运行。")
        sys.exit(1)
    print("数据可用于建模。")


if __name__ == "__main__":
    main()
