"""把模型数据打包成 game-demo 里的 data*.js，网页双击就能读（不用服务器）。

用法（项目根目录）：.venv\\Scripts\\python.exe game-demo/build_data.py

隔离规则（发起人 9/25 要求：试验不得污染原始数据集）：
- 只读 data/model、data/web 里已经做好的文件，一个字节都不写回去；
- 只往 game-demo/ 里写；写之前检查路径，写到别处直接报错；
- 读之前、写完之后各算一次输入文件的指纹（SHA-256），不一致就报错；
  指纹记在 game-demo/data-sources.json，随时能核对演示用的是哪一版数据。
网页本身只在浏览器内存里算，不写任何文件。

打包的内容：
- data.js：455 个交通分区（名字、区、人口、岗位、中心点、简化边界）；早高峰开车时间表（用 pipeline/27
  分配后的拥堵路段时间重算最短路）；早高峰车流（私家车、的士 pipeline/24；货车 pipeline/26）
- data-metro.js：早高峰公交时间表、公交/开车人次、全天换算、时间价值、方式选择敏感度、出行分布的距离衰减、分区面积
- data-road.js：早高峰路网（每段路的畅通时间、通行能力、现状车流、路名；哪些路口能接新桥），浏览器里重新分配车流用
- data-land.js：陆地 / 水面格（约 40 米，规划署 2024 土地用途格网里的海和水塘），桥头、车站、走路进站不能跨水
"""
import base64
import hashlib
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import mapping, shape

ROOT = Path(__file__).resolve().parents[1]
HERE = Path(__file__).resolve().parent
MODEL, WEB = ROOT / "data" / "model", ROOT / "data" / "web"

INPUTS = [MODEL / f for f in ("skim-car-freeflow.npz", "am-peak-2026.npz", "goods-2026.npz", "zone-centres.parquet",
                              "road-links.parquet", "road-connectors.parquet", "road-nodes.parquet", "assignment-am-2026.parquet",
                              "skim-active-transit.npz", "mode-split-2026.npz")] + \
         [WEB / f for f in ("am-peak-audit.json", "traffic/atc-stations.json", "zones-2026.geojson",
                            "mode-choice-audit.json", "trip-distribution-audit.json")] + \
         [ROOT / "data" / "raw" / "road-network" / "RdNet_IRNP.gdb.zip", ROOT / "data" / "raw" / "landuse" / "luhk2024_codes.tif"]

SIMPLIFY_DEG = 0.0004   # 约 40 米
UNREACHABLE_MIN = 600
CONNECTOR_KPH = 25      # 与 pipeline/17、27 一致
LAND_GRID = ROOT / "data" / "raw" / "landuse" / "luhk2024_codes.tif"   # pipeline/36：规划署 2024 土地用途 10 米格网
WATER_CODES = (0, 91)   # 海、水塘（与 pipeline/15「接驳不跨水」一致；河道 92 不算，沿河桥多）
LAND_DEG = 0.0004       # 陆地 / 水面格约 40 米
BPR_BETA = 4.0   # 与 pipeline/27 一致；alpha 每段路不同（隧道串放大，见 pipeline/27 tunnel_queue），从分配结果读
PURPOSES = ("HBW", "HBS", "HBO", "NHB", "CBS", "CBR", "CBV")


def fingerprint(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def write(name: str, var: str, data: dict) -> Path:
    out = (HERE / name).resolve()
    if out.parent != HERE:
        raise RuntimeError(f"拒绝写到 game-demo 以外：{out}")
    out.write_text(f"window.{var} = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n",
                   encoding="utf-8")
    print(f"-> {out.name} ({out.stat().st_size / 1e6:.2f} MB)")
    return out


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode("ascii")


def chinese_street_names() -> dict:
    """运输署路网中心线的中文路名（按 ROUTE_ID），只读原始下载。"""
    if Path("F:/tools/gdal-tmp").is_dir():   # GDAL 读中文用户名路径的坑（发起人电脑）；别的电脑用默认临时目录
        os.environ.setdefault("CPL_TMPDIR", "F:/tools/gdal-tmp")
    import pyogrio
    df = pyogrio.read_dataframe(ROOT / "data" / "raw" / "road-network" / "RdNet_IRNP.gdb.zip", layer="CENTERLINE",
                                columns=["ROUTE_ID", "STREET_CNAME"], read_geometry=False)
    df = df[df["STREET_CNAME"].notna() & (df["STREET_CNAME"] != "-99")]
    return dict(zip(df["ROUTE_ID"].astype(int), df["STREET_CNAME"].astype(str)))


def road_graph(ids: list[str]) -> dict:
    """路网：路段 + 分区接驳。分区各有一个「出发点」（只有出边）和「到达点」（只有入边），路径不会穿过分区中心。"""
    chinese = chinese_street_names()
    links = pd.read_parquet(MODEL / "road-links.parquet").set_index("link_id")
    a = pd.read_parquet(MODEL / "assignment-am-2026.parquet")
    a = a[a["road_link"] > 0]
    ends = links.loc[a["road_link"], ["a_node", "b_node"]].to_numpy()
    fwd = (a["side"] == "ab").to_numpy()
    n_nodes = int(links[["a_node", "b_node"]].to_numpy().max()) + 1
    n = len(ids)
    origin = {z: n_nodes + k for k, z in enumerate(ids)}
    dest = {z: n_nodes + n + k for k, z in enumerate(ids)}
    con = pd.read_parquet(MODEL / "road-connectors.parquet")
    con = con[con["zone"].isin(origin)]
    c_min = (con["metres"] / 1000 / CONNECTOR_KPH * 60).clip(lower=1e-3).to_numpy()
    streets = [chinese.get(r, "") or ("" if not isinstance(s, str) or s in ("-99", "nan") else s)
               for r, s in links.loc[a["road_link"], ["route_id", "street"]].itertuples(index=False)]
    names = sorted(set(streets))
    name_id = {s: k for k, s in enumerate(names)}
    return {
        "n_nodes": n_nodes + 2 * n,
        "src": np.concatenate([np.where(fwd, ends[:, 0], ends[:, 1]), con["zone"].map(origin), con["node_id"]]).astype(int),
        "dst": np.concatenate([np.where(fwd, ends[:, 1], ends[:, 0]), con["node_id"], con["zone"].map(dest)]).astype(int),
        "n_road": len(a),
        "free": a["free_time"].to_numpy(), "cap": a["capacity"].to_numpy(), "vol": a["total"].to_numpy(),
        "congested": a["congested_time"].to_numpy(), "alpha": a["alpha"].to_numpy(), "connector_min": np.concatenate([c_min, c_min]),
        "name": np.array([name_id[s] for s in streets]), "names": names,
        "origin": [origin[z] for z in ids], "dest": [dest[z] for z in ids],
    }


def peak_skim(g: dict) -> np.ndarray:
    """早高峰开车时间表：用分配后每段路的拥堵时间，重算分区到分区的最短时间。"""
    from scipy.sparse import csr_matrix
    from scipy.sparse.csgraph import dijkstra
    w = np.concatenate([np.clip(g["congested"], 1e-3, None), g["connector_min"]])
    # 同一对路口之间可能有并行路段；稀疏矩阵会把重复项相加，所以先取最快的那条
    e = pd.DataFrame({"s": g["src"], "d": g["dst"], "w": w}).groupby(["s", "d"], as_index=False)["w"].min()
    m = csr_matrix((e["w"], (e["s"], e["d"])), shape=(g["n_nodes"], g["n_nodes"]))
    t = dijkstra(m, directed=True, indices=g["origin"])[:, g["dest"]]
    np.fill_diagonal(t, 0)
    return t


def build_road(g: dict) -> None:
    """浏览器里重新分配车流用的路网。拥堵时间 = 畅通时间 ×（1 + alpha ×（车流 / 通行能力）^4），与 pipeline/27 相同
    （alpha 一般 0.15，隧道串按排队时间放大）。"""
    check = g["free"] * (1 + g["alpha"] * (g["vol"] / g["cap"]) ** BPR_BETA)
    err = np.abs(check - g["congested"])
    print(f"路网：{g['n_road']:,} 个行车方向 + {len(g['connector_min']):,} 条接驳；"
          f"用公式重算拥堵时间与分配结果最大相差 {err.max():.4f} 分钟")
    assert err.max() < 0.01, "拥堵公式和 pipeline/27 对不上"
    # 路口经纬度：桥头吸附到真实路口、画车真实开的路线用（香港 1980 方格网 -> 经纬度）
    from pyproj import Transformer
    nodes = pd.read_parquet(MODEL / "road-nodes.parquet").set_index("node_id")
    n_road_nodes = g["n_nodes"] - 2 * len(g["origin"])
    xy = nodes.reindex(range(n_road_nodes))[["x", "y"]].to_numpy()
    lon, lat = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True).transform(xy[:, 0], xy[:, 1])
    lon, lat = np.nan_to_num(lon, nan=0.0), np.nan_to_num(lat, nan=0.0)
    print(f"路口 {n_road_nodes:,} 个，经度 {np.nanmin(lon[lon > 0]):.3f}–{lon.max():.3f}，纬度 {np.nanmin(lat[lat > 0]):.3f}–{lat.max():.3f}")
    ok = bridge_heads(n_road_nodes, xy)
    write("data-road.js", "ROAD_DATA", {
        "nNodes": g["n_nodes"], "nRoad": g["n_road"], "nRoadNodes": n_road_nodes,
        "nodeLon": b64(lon.astype("<f4")), "nodeLat": b64(lat.astype("<f4")), "nodeOK": b64(ok.astype("<u1")),
        "src": b64(g["src"].astype("<i4")), "dst": b64(g["dst"].astype("<i4")),
        "free": b64(g["free"].astype("<f4")), "cap": b64(g["cap"].astype("<f4")), "vol": b64(g["vol"].astype("<f4")),
        "alpha": b64(g["alpha"].astype("<f4")),
        "connMin": b64(g["connector_min"].astype("<f4")),
        "name": b64(g["name"].astype("<u2")), "names": g["names"],
        "origin": g["origin"], "dest": g["dest"], "bpr": [0.15, BPR_BETA],
    })


def land_codes():
    import rasterio
    with rasterio.open(LAND_GRID) as src:
        return src.read(1), src.transform


def bridge_heads(n: int, xy: np.ndarray) -> np.ndarray:
    """新桥能接的路口：在陆地上的地面路口。桥面、天桥、隧道、收费广场、快速公路上的路口都不能接
    （不能从海底隧道中间或青马大桥桥面上岔出一座桥）。"""
    links = pd.read_parquet(MODEL / "road-links.parquet")
    r = links[links["routable"]]
    bad = ((r["elevation"] != 0) | r["toll_facility"].notna() | (r["road_class"] == "expressway")
           | r["street"].astype(str).str.strip().str.contains(r"(?:TUNNEL|HARBOUR CROSSING)$", regex=True))
    on_road = np.zeros(n, bool)
    on_road[np.concatenate([r["a_node"], r["b_node"]])] = True
    touches_bad = np.zeros(n, bool)
    touches_bad[np.concatenate([r.loc[bad, "a_node"], r.loc[bad, "b_node"]])] = True
    import rasterio
    codes, tf = land_codes()
    finite = np.isfinite(xy).all(axis=1)
    rows, cols = rasterio.transform.rowcol(tf, np.where(finite, xy[:, 0], 0), np.where(finite, xy[:, 1], 0))
    rows = np.clip(np.asarray(rows), 0, codes.shape[0] - 1)
    cols = np.clip(np.asarray(cols), 0, codes.shape[1] - 1)
    dry = finite & ~np.isin(codes[rows, cols], WATER_CODES)
    ok = on_road & ~touches_bad & dry
    print(f"桥头可接的路口 {ok.sum():,} / {on_road.sum():,} 个（排除：连着桥面/隧道/收费/快速公路的 {(on_road & touches_bad).sum():,}，"
          f"落在海或水塘格里的 {(on_road & ~touches_bad & ~dry).sum():,}）")
    return ok


def build_land() -> None:
    """陆地 / 水面格网：10 米格按 4×4 并成 40 米，一半以上是海或水塘就算水，再重采样成约 40 米的经纬度格。
    桥头、地铁站、走路进站都靠它判断「能不能过去」。格网以外（深圳、外海）一律算水。"""
    from pyproj import Transformer
    codes, tf = land_codes()
    wet = np.isin(codes, WATER_CODES).astype(np.float32)
    h, w = wet.shape[0] // 4 * 4, wet.shape[1] // 4 * 4
    frac = wet[:h, :w].reshape(h // 4, 4, w // 4, 4).mean(axis=(1, 3))
    left, top, cell = tf.c, tf.f, tf.a * 4
    to_ll = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True)
    corners = to_ll.transform([left, left + w * tf.a, left, left + w * tf.a], [top, top, top - h * tf.a, top - h * tf.a])
    lon0, lat0 = np.floor(np.array([min(corners[0]), min(corners[1])]) / LAND_DEG) * LAND_DEG
    nx = int(np.ceil((max(corners[0]) - lon0) / LAND_DEG))
    ny = int(np.ceil((max(corners[1]) - lat0) / LAND_DEG))
    glon, glat = np.meshgrid(lon0 + (np.arange(nx) + 0.5) * LAND_DEG, lat0 + (np.arange(ny) + 0.5) * LAND_DEG)
    x, y = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True).transform(glon.ravel(), glat.ravel())
    col, row = np.floor((x - left) / cell).astype(int), np.floor((top - y) / cell).astype(int)
    inside = (row >= 0) & (row < frac.shape[0]) & (col >= 0) & (col < frac.shape[1])
    water = np.ones(nx * ny, bool)
    water[inside] = frac[row[inside], col[inside]] >= 0.5
    write("data-land.js", "LAND_DATA", {
        "lon0": round(float(lon0), 6), "lat0": round(float(lat0), 6), "d": LAND_DEG, "nx": nx, "ny": ny,
        "bits": b64(np.packbits(water)),   # 第 j 行（从南往北）第 i 列 = 第 j*nx+i 位，高位在前；1 = 水
    })
    print(f"陆地格 {nx}×{ny}（{LAND_DEG}° ≈ 40 米），水面占 {water.mean():.0%}；陆地约 {(~water).sum() * (LAND_DEG * 111.2) ** 2 * 0.925:,.0f} 平方公里")


def build_metro(ids: list[str], idx: np.ndarray, peak, areas: list[float]) -> None:
    """地铁版：早高峰公交时间表、公交/开车人次、全天换算、时间价值、方式选择与出行分布的参数。"""
    skim = np.load(MODEL / "skim-active-transit.npz")
    assert [str(z) for z in skim["zones"]] == ids
    t = skim["transit_min"].astype(float)
    t[~np.isfinite(t) | (t > UNREACHABLE_MIN)] = np.inf
    t10 = np.where(np.isfinite(t), np.round(t * 10), 65535).astype("<u2")

    pick = lambda m: m[np.ix_(idx, idx)].astype(float)
    pt, car = pick(peak["P_PT"]), pick(peak["P_PV"]) + pick(peak["P_TAXI"])
    for m in (pt, car):
        np.fill_diagonal(m, 0)
    daily = np.load(MODEL / "mode-split-2026.npz")
    day = lambda mode, p=PURPOSES: sum(float(daily[f"T_{q}_{mode}"].sum()) for q in p)
    pt_factor = day("PT") / float(peak["P_PT"].sum())
    car_factor = (day("PV") + day("TAXI")) / float(peak["P_PV"].sum() + peak["P_TAXI"].sum())

    mc = json.loads((WEB / "mode-choice-audit.json").read_text(encoding="utf-8"))
    vot = mc["values_of_time_hkd_per_min"]
    vot_pt = float(np.mean([vot[k] for k in vot if k.endswith("_nopv")]))
    occ = json.loads((WEB / "am-peak-audit.json").read_text(encoding="utf-8"))
    frac = occ["fraction_of_daily"]
    # 出行分布（pipeline/22）：各目的的距离衰减 beta（每「调查自报」分钟）× r（自报 / 引擎时间）
    dist = json.loads((WEB / "trip-distribution-audit.json").read_text(encoding="utf-8"))
    w = {p: sum(float(daily[f"T_{p}_{m}"].sum()) for m in ("PT", "PV", "TAXI")) * frac[p] for p in ("HBW", "HBS", "HBO", "NHB")}
    beta_peak = sum(dist["purposes"][p]["beta"] * w[p] for p in w) / sum(w.values())
    ppv = occ["people_per_vehicle"]
    car_occ = (float(peak["P_PV"].sum()) + float(peak["P_TAXI"].sum())) / \
              (float(peak["V_PV"].sum()) + float(peak["V_TAXI"].sum()))

    write("data-metro.js", "METRO_DATA", {
        "ptTime10": b64(t10), "pt": b64(pt.astype("<f4")), "car": b64(car.astype("<f4")),
        "ptDaily": round(pt_factor, 3), "carDaily": round(car_factor, 3),
        "votPt": round(vot_pt, 3), "votCar": 1.26, "theta": mc["sensitivity_per_min"],
        "betaPeak": round(beta_peak, 5), "betaHBW": dist["purposes"]["HBW"]["beta"], "r": dist["time_scale_r"],
        "carOcc": round(car_occ, 3), "area": [round(a, 4) for a in areas],
    })
    print(f"地铁版：早高峰公交 {pt.sum():,.0f} 人次、开车 {car.sum():,.0f} 人次（每车 {car_occ:.2f} 人）；全天 = 高峰 x 公交 "
          f"{pt_factor:.2f} / 开车 {car_factor:.2f}；公交时间价值 {vot_pt:.2f}；敏感度 {mc['sensitivity_per_min']:.4f}；"
          f"早高峰距离衰减 {beta_peak:.4f}（上班 {dist['purposes']['HBW']['beta']:.4f}）× r {dist['time_scale_r']}")


def main() -> None:
    before = {p: fingerprint(p) for p in INPUTS}

    skim = np.load(MODEL / "skim-car-freeflow.npz")
    ids = [str(z) for z in skim["zones"]]
    g = road_graph(ids)
    t = peak_skim(g)
    t[~np.isfinite(t) | (t > UNREACHABLE_MIN)] = np.inf
    t10 = np.where(np.isfinite(t), np.round(t * 10), 65535).astype("<u2")

    peak = np.load(MODEL / "am-peak-2026.npz")
    goods = np.load(MODEL / "goods-2026.npz")
    pos = {str(z): k for k, z in enumerate(peak["zones"])}
    assert [str(z) for z in goods["zones"]] == [str(z) for z in peak["zones"]]
    idx = np.array([pos[z] for z in ids])
    pick = lambda m: m[np.ix_(idx, idx)].astype(float)
    pv, taxi = pick(peak["V_PV"]), pick(peak["V_TAXI"])
    gl, gh = pick(goods["V_GOODS_LIGHT"]), pick(goods["V_GOODS_HEAVY"])

    audit = json.loads((WEB / "am-peak-audit.json").read_text(encoding="utf-8"))
    occ = audit["people_per_vehicle"]
    # 时间价值（元/分钟），与 pipeline/27 的报告一致：私家车、的士按人，货车按车
    vot = {"pv": 1.26, "taxi": 0.87, "goods_light": 2.74, "goods_heavy": 4.06}
    veh = pv + taxi + gl + gh
    ppl = pv * occ["PV"] + taxi * occ["TAXI"] + gl + gh
    val = (pv * occ["PV"] * vot["pv"] + taxi * occ["TAXI"] * vot["taxi"]
           + gl * vot["goods_light"] + gh * vot["goods_heavy"])
    for m in (veh, ppl, val):
        np.fill_diagonal(m, 0)

    census = json.loads((WEB / "traffic" / "atc-stations.json").read_text(encoding="utf-8"))
    share = np.median([r["weekday_pct"][8] for r in census["hourly"] if r["year"] == 2024 and r.get("weekday_pct")])
    daily_factor = 100 / share

    geo = json.loads((WEB / "zones-2026.geojson").read_text(encoding="utf-8"))
    by_id = {f["properties"]["zone"]: f for f in geo["features"]}
    cen = pd.read_parquet(MODEL / "zone-centres.parquet").set_index("zone")
    zones, feats, areas = [], [], []
    for k, z in enumerate(ids):
        p = by_id[z]["properties"]
        gm = shape(by_id[z]["geometry"]).simplify(SIMPLIFY_DEG, preserve_topology=True)
        c = gm.representative_point()
        lon, lat = (float(cen.at[z, "lon"]), float(cen.at[z, "lat"])) if z in cen.index else (c.x, c.y)
        zones.append([z, p.get("label") or z, p.get("district", ""), int(p.get("population", 0)),
                      int(p.get("jobs", 0)), round(lon, 5), round(lat, 5), bool(p.get("road_access", True))])
        areas.append(float(p.get("area_km2", 0)))
        gj = json.loads(json.dumps(mapping(gm)), parse_float=lambda s: round(float(s), 4))
        feats.append({"type": "Feature", "properties": {"i": k}, "geometry": gj})

    outs = [write("data.js", "GAME_DATA", {
        "zones": zones, "geo": {"type": "FeatureCollection", "features": feats}, "n": len(ids),
        "time10": b64(t10), "veh": b64(veh.astype("<f4")), "ppl": b64(ppl.astype("<f4")), "val": b64(val.astype("<f4")),
        "dailyFactor": round(float(daily_factor), 2), "vot": vot, "occ": {"pv": occ["PV"], "taxi": occ["TAXI"]},
    })]
    print(f"分区 {len(ids)} 个；早高峰车次 {veh.sum():,.0f}，人次 {ppl.sum():,.0f}；全天 = 早高峰 x {daily_factor:.2f}"
          f"（普查站 8-9 点占全天中位 {share:.2f}%）；开不到车的起终点对 {int((t10 == 65535).sum())} 个")
    build_metro(ids, idx, peak, areas)
    build_road(g)
    build_land()

    after = {p: fingerprint(p) for p in INPUTS}
    changed = [str(p) for p in INPUTS if before[p] != after[p]]
    if changed:
        raise RuntimeError(f"原始数据在打包过程中变了（不该发生）：{changed}")
    sources = {"note": "game-demo 的数据来自下列原始文件（只读）；指纹 = SHA-256",
               "files": {p.relative_to(ROOT).as_posix(): after[p] for p in INPUTS}}
    (HERE / "data-sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"原始数据 {len(INPUTS)} 个文件：读前读后指纹一致，未被改动 -> data-sources.json")


if __name__ == "__main__":
    main()
