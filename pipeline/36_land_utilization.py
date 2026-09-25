"""第 36 步：土地用途（规划署《香港土地利用》2024，10 米格网）→ 每个交通分区各类用途多少公顷。

Input : 规划署 LUHK 2024 栅格（CSDI 地图服务 pland_rcd_1725865972233_20687）
        规划署 LUHK 2024 统计表（data.gov.hk，27 类用途的全港面积）
        data/web/zones-2026.geojson（455 个交通分区）
Output: data/raw/landuse/luhk2024_codes.tif      原始编号格网（香港 1980 方格网，10 米）
        data/raw/landuse/luhk2024_statistics_*.csv 规划署统计表（英文 / 简体）
        data/model/land-utilization-2024.parquet  每个分区 × 27 类用途的面积（公顷）
        data/web/land-utilization-audit.json

为什么要这样取：数据集的「下载」链接对程序返回 403（之前存下的 luhk2024_raster.zip 其实是那张 403 网页），
但同一数据集的地图服务能按 10 米原分辨率导出。导出图是灰度拉伸（编号 0–92 线性拉到 0–255），
每个灰度对应一个编号：逐个灰度用服务的「点查询」读出真实编号（并抽样复核），再换回编号。
例外：编号 1（私人住宅）、2（公营房屋）被拉伸压成了纯黑，和海面（无数据）同色。分法：海面是连着图边的一大片黑，
住宅是被其他用途包围、不连边的黑块；私人还是公营按最近的住宅楼是否在屋宇署登记来分（见 split_residential）。
编号的含义用面积对账确定：每个编号的格子数 × 100 平方米，与规划署统计表逐类比，全部 27 类都要对上。

用途：TOD / 土地一侧的底。哪里是住宅、哪里是空地和棕地（货仓露天贮物）、哪里是农地、林地，
新线开通后人口和岗位能往哪里长，都从这里来。
"""
import io
import json
import time
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "landuse"
MAP = "https://portal.csdi.gov.hk/server/rest/services/common/pland_rcd_1725865972233_20687/MapServer"
STATS = "https://www.pland.gov.hk/pland_en/resources/statistic/landu/csv/LUHK2024_{}.csv"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"}
EXTENT = (800000, 800000, 863750, 848000)   # 服务公布的全幅范围（香港 1980 方格网，米）
CELL = 10
SPLIT_X, SPLIT_Y = 832000, 824000            # 分四块导出（服务单张最大 4096 像素）
OUT = ROOT / "data" / "model" / "land-utilization-2024.parquet"
AUDIT = ROOT / "data" / "web" / "land-utilization-audit.json"

# 编号 → 规划署 27 类（按统计表的顺序；由面积对账确定，见 check_against_statistics）
CODES = {
    1: ("Residential", "Private Residential", "私人住宅"),
    2: ("Residential", "Public Residential", "公营房屋"),
    3: ("Residential", "Rural Settlement", "乡郊居所"),
    11: ("Commercial", "Commercial/Business and Office", "商业／商贸和办公室"),
    21: ("Industrial", "Industrial Land", "工业用地"),
    22: ("Industrial", "Industrial Estates/Science and Technology Parks", "工业邨／科技园"),
    23: ("Industrial", "Warehouse and Open Storage", "货仓和露天贮物"),
    31: ("Institutional/Open Space", "Government/Institutional and Community Facilities", "政府、机构和社区设施"),
    32: ("Institutional/Open Space", "Open Space and Recreation", "休憩和康乐"),
    41: ("Transportation", "Roads and Transport Facilities", "道路和运输设施"),
    42: ("Transportation", "Railways", "铁路"),
    43: ("Transportation", "Airport", "机场"),
    44: ("Transportation", "Port Facilities", "港口设施"),
    51: ("Other Urban or Built-up Land", "Cemeteries/Funeral Facilities", "坟场／殡殓设施"),
    52: ("Other Urban or Built-up Land", "Utilities", "公用事业设施"),
    53: ("Other Urban or Built-up Land", "Vacant land/Construction in Progress", "空置／正在施工"),
    54: ("Other Urban or Built-up Land", "Others", "其他都市用地"),
    61: ("Agriculture", "Agricultural land", "农地"),
    62: ("Agriculture", "Fish Ponds/Gei Wais", "鱼塘／基围"),
    71: ("Woodland/Shrubland/Grassland/Wetland", "Woodland", "林地"),
    72: ("Woodland/Shrubland/Grassland/Wetland", "Shrubland", "灌丛"),
    73: ("Woodland/Shrubland/Grassland/Wetland", "Grassland", "草地"),
    74: ("Woodland/Shrubland/Grassland/Wetland", "Mangrove/Swamp", "红树林／沼泽"),
    81: ("Barren Land", "Badland", "劣地"),
    83: ("Barren Land", "Rocky Shore", "岩岸"),
    91: ("Water Bodies", "Reservoirs", "水塘"),
    92: ("Water Bodies", "Streams and nullahs", "河道和明渠"),
}


def get(url: str, params: dict | None = None, attempts: int = 4) -> httpx.Response:
    for attempt in range(attempts):
        try:
            r = httpx.get(url, params=params, headers=HEADERS, timeout=300)
            r.raise_for_status()
            return r
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))


def export_gray() -> np.ndarray:
    """全港灰度格网（行 = 由北往南，列 = 由西往东），按原分辨率分四块导出后拼起来。"""
    x0, y0, x1, y1 = EXTENT
    grid = np.zeros(((y1 - y0) // CELL, (x1 - x0) // CELL), dtype=np.uint8)
    for bx0, bx1 in ((x0, SPLIT_X), (SPLIT_X, x1)):
        for by0, by1 in ((y0, SPLIT_Y), (SPLIT_Y, y1)):
            w, h = (bx1 - bx0) // CELL, (by1 - by0) // CELL
            r = get(MAP + "/export", {"bbox": f"{bx0},{by0},{bx1},{by1}", "bboxSR": 2326, "imageSR": 2326,
                                      "size": f"{w},{h}", "format": "png8", "transparent": "false", "dpi": 96, "f": "image"})
            rgb = np.array(Image.open(io.BytesIO(r.content)).convert("RGB"))
            assert rgb.shape[:2] == (h, w), f"导出尺寸不对：{rgb.shape}"
            assert (rgb[..., 0] == rgb[..., 1]).all() and (rgb[..., 1] == rgb[..., 2]).all(), "导出图不是灰度"
            row0, col0 = (y1 - by1) // CELL, (bx0 - x0) // CELL
            grid[row0:row0 + h, col0:col0 + w] = rgb[..., 0]
            print(f"  导出 {bx0}-{bx1} × {by0}-{by1}：{w}×{h}")
    return grid


def identify(x: float, y: float) -> int | None:
    x0, y0, x1, y1 = EXTENT
    r = get(MAP + "/identify", {"geometry": f"{x},{y}", "geometryType": "esriGeometryPoint", "sr": 2326, "layers": "all:0",
                                "tolerance": 0, "mapExtent": f"{x0},{y0},{x1},{y1}",
                                "imageDisplay": f"{(x1 - x0) // CELL},{(y1 - y0) // CELL},96", "returnGeometry": "false", "f": "json"})
    res = r.json().get("results", [])
    if not res:
        return None
    v = res[0]["attributes"].get("Stretch.Pixel Value", res[0]["attributes"].get("Pixel Value"))
    return None if v in (None, "NoData") else int(float(v))


def gray_to_code(grid: np.ndarray, report: list) -> dict:
    """每个灰度用点查询读出真实编号；每个灰度查 3 个随机格子，必须一致。"""
    x0, y1 = EXTENT[0], EXTENT[3]
    rng = np.random.default_rng(0)
    mapping = {}
    for g in np.unique(grid):
        rows, cols = np.nonzero(grid == g)
        pick = rng.choice(len(rows), size=min(3, len(rows)), replace=False)
        codes = {identify(x0 + (cols[k] + 0.5) * CELL, y1 - (rows[k] + 0.5) * CELL) for k in pick}
        assert len(codes) == 1, f"灰度 {g} 查到不止一个编号：{codes}"
        mapping[int(g)] = codes.pop()
    report.append("灰度 → 编号：" + "，".join(f"{g}→{c}" for g, c in sorted(mapping.items())))
    return mapping


def split_residential(gray: np.ndarray, codes: np.ndarray, land: np.ndarray, report: list) -> dict:
    """纯黑 = 海面 + 私人住宅(1) + 公营房屋(2)。

    海面：连着图边的一大片黑。住宅：被其他用途包围、不连边的黑块；另外，海边屋苑的黑会和海连成一片，
    所以连着海的黑格子如果在交通分区（陆地）范围内、且 120 米内有三层以上住宅楼，也算住宅。
    私人还是公营：每个住宅格子看最近的三层以上住宅楼（第 10 步的住宅判定）。算公营的：屋宇署没有登记用途的
    （房委会公屋、居屋不在屋宇署记录里，第 10 步把这些「未登记的塔楼」补成住宅），以及中文楼名带「邨」（公屋、
    房协出租屋）或「苑」（居屋等资助出售房屋，部分在屋宇署有登记）的。几种规则与统计表比过：只看登记 30.6/16.1，
    加「邨」「苑」29.1/17.7，再加英文 "Court" 27.1/19.6；统计表是 28/18，取第二种。
    （曾试过逐点向服务查编号，请求太多被服务器以 403 挡住，所以改用手上的楼宇数据。）
    """
    from scipy import ndimage
    from scipy.spatial import cKDTree
    from pyproj import Transformer
    black = gray == 0
    lab, _ = ndimage.label(black)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    sea_like = np.isin(lab, edge[edge > 0])
    res = black & ~sea_like

    b = pd.read_parquet(ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet",
                        columns=["lon", "lat", "storeys", "use", "dwelling", "BuildingNameTC"])
    b = b[b["dwelling"] & (b["storeys"] >= 3)]
    x, y = Transformer.from_crs("EPSG:4326", "EPSG:2326", always_xy=True).transform(b["lon"].to_numpy(), b["lat"].to_numpy())
    brow, bcol = (EXTENT[3] - y) / CELL, (x - EXTENT[0]) / CELL
    name = b["BuildingNameTC"].fillna("").astype(str)
    public = ((b["use"] != "residential") | name.str.contains("邨") | name.str.contains("苑")).to_numpy()
    tree = cKDTree(np.column_stack([brow, bcol]))
    crow, ccol = np.nonzero(black & sea_like & land)
    near, _ = tree.query(np.column_stack([crow, ccol]), distance_upper_bound=120 / CELL)
    coastal = np.isfinite(near)
    res[crow[coastal], ccol[coastal]] = True
    rows, cols = np.nonzero(res)
    dist, idx = tree.query(np.column_stack([rows, cols]))
    codes[rows, cols] = np.where(public[idx], 2, 1)
    far = dist * CELL > 200
    report.append(f"纯黑里的住宅 {res.sum() / 1e4:.1f} 平方公里（其中海边与海面连成一片、按楼找回的 {coastal.sum() / 1e4:.1f}）；按最近的三层以上住宅楼分：私人 "
                  f"{(codes[rows, cols] == 1).sum() / 1e4:.1f}、公营 {(codes[rows, cols] == 2).sum() / 1e4:.1f}；"
                  f"{far.mean():.1%} 的住宅格子 200 米内没有楼（按更远的楼算）")
    return {"residential_km2": float(res.sum() / 1e4), "coastal_recovered_km2": float(coastal.sum() / 1e4),
            "far_share": float(far.mean())}


def check_against_statistics(codes: np.ndarray, report: list) -> dict:
    """每个编号的面积与规划署统计表逐类对账（统计表精确到 1 平方公里）。"""
    for lang in ("English", "SC"):
        (RAW / f"luhk2024_statistics_{lang.lower()}.csv").write_bytes(get(STATS.format(lang)).content)
    stats = pd.read_csv(RAW / "luhk2024_statistics_english.csv", encoding="utf-8-sig")
    km2 = {int(c): n * CELL * CELL / 1e6 for c, n in zip(*np.unique(codes, return_counts=True)) if c > 0}
    unknown = sorted(set(km2) - set(CODES))
    assert not unknown, f"格网里有未定义的编号：{unknown}"
    rows, worst, worst_res = [], 0.0, 0.0
    for code, (cls, cat, cn) in CODES.items():
        official = float(stats.loc[stats["Category"] == cat, "Area"].iloc[0])
        mine = km2.get(code, 0.0)
        if code in (1, 2):   # 私人 / 公营是推算的（见 split_residential），单独算
            worst_res = max(worst_res, abs(mine - official))
        else:
            worst = max(worst, abs(mine - official))
        rows.append({"code": code, "class": cls, "category": cat, "name": cn, "grid_km2": round(mine, 2), "official_km2": official})
    total = sum(km2.values())
    report.append(f"25 类读出来的用途与统计表最大相差 {worst:.2f} 平方公里、推算的私人/公营住宅最大相差 {worst_res:.2f}"
                  f"（统计表只到整数）；格网陆地合计 {total:.1f}，统计表 "
                  f"{stats['Area'].sum():.0f}")
    return {"rows": rows, "worst_km2": worst, "worst_residential_km2": worst_res, "total_km2": total,
            "official_total_km2": float(stats["Area"].sum())}


def zone_raster(shape: tuple) -> tuple:
    import geopandas as gpd
    from rasterio import features
    from rasterio.transform import from_origin
    zones = gpd.read_file(ROOT / "data" / "web" / "zones-2026.geojson").to_crs(2326)
    label = features.rasterize(((g, k + 1) for k, g in enumerate(zones.geometry)), out_shape=shape,
                               transform=from_origin(EXTENT[0], EXTENT[3], CELL, CELL), fill=0, dtype="int32")
    return zones, label


def zone_areas(codes: np.ndarray, zones, label: np.ndarray, report: list) -> tuple[pd.DataFrame, dict]:
    n, ncode = len(zones), max(CODES) + 1
    counts = np.bincount(label.ravel() * ncode + codes.ravel().astype(np.int64), minlength=(n + 1) * ncode).reshape(n + 1, ncode)
    ha = counts * CELL * CELL / 1e4
    table = pd.DataFrame({"zone": zones["zone"]})
    for code, (_, cat, cn) in CODES.items():
        table[f"ha_{code}"] = ha[1:, code]
    table["land_ha"] = ha[1:, 1:].sum(axis=1)
    land_total = ha[:, 1:].sum()
    outside = ha[0, 1:].sum()
    area_attr = zones["area_km2"].to_numpy() * 100
    rel = np.abs(table["land_ha"] - area_attr) / np.maximum(area_attr, 1)
    report.append(f"陆地 {land_total / 100:.1f} 平方公里中 {outside / 100:.1f} 落在 455 个分区以外（多为海边、小岛）；"
                  f"分区陆地面积与分区面积相差中位 {np.median(rel) * 100:.1f}%")
    return table, {"land_outside_zones_km2": outside / 100, "median_zone_area_gap": float(np.median(rel))}


def main() -> None:
    report: list[str] = []
    RAW.mkdir(parents=True, exist_ok=True)
    broken = RAW / "luhk2024_raster.zip"
    if broken.exists() and broken.stat().st_size < 10_000:
        broken.unlink()
        report.append("删掉了 luhk2024_raster.zip（1.5 KB 的 403 网页，不是数据）")

    cache = ROOT / "data" / "cache" / "luhk2024"
    cache.mkdir(parents=True, exist_ok=True)
    if (cache / "gray.npy").exists() and (cache / "gray_to_code.json").exists():
        gray = np.load(cache / "gray.npy")
        mapping = {int(k): v for k, v in json.loads((cache / "gray_to_code.json").read_text()).items()}
        report.append("灰度格网和灰度→编号对照表取自缓存（data/cache/luhk2024，不重复请求政府服务）")
    else:
        gray = export_gray()
        mapping = gray_to_code(gray, report)
        np.save(cache / "gray.npy", gray)
        (cache / "gray_to_code.json").write_text(json.dumps(mapping))
    lut = np.zeros(256, dtype=np.uint8)
    for g, c in mapping.items():
        lut[g] = 0 if c is None else c
    codes = lut[gray]
    zones, label = zone_raster(codes.shape)
    split = split_residential(gray, codes, label > 0, report)

    import rasterio
    from rasterio.transform import from_origin
    with rasterio.open(RAW / "luhk2024_codes.tif", "w", driver="GTiff", height=codes.shape[0], width=codes.shape[1], count=1,
                       dtype="uint8", crs="EPSG:2326", transform=from_origin(EXTENT[0], EXTENT[3], CELL, CELL),
                       compress="deflate", nodata=0) as dst:
        dst.write(codes, 1)

    check = check_against_statistics(codes, report)
    table, zcheck = zone_areas(codes, zones, label, report)
    table.to_parquet(OUT, index=False)

    flags = []
    if check["worst_km2"] > 1.0:
        flags.append(f"有用途类别与统计表相差 {check['worst_km2']:.2f} 平方公里（> 1）")
    if check["worst_residential_km2"] > 1.5:
        flags.append(f"私人/公营住宅与统计表相差 {check['worst_residential_km2']:.2f} 平方公里（> 1.5）")
    if abs(check["total_km2"] - check["official_total_km2"]) > 5:
        flags.append(f"陆地合计 {check['total_km2']:.1f} 与统计表 {check['official_total_km2']:.0f} 相差超过 5 平方公里")
    audit = {"source": "规划署《香港土地利用》2024（10 米格网，卫星影像 2024 年 12 月）", "gray_to_code": mapping,
             "categories": check["rows"], "zone_check": zcheck, "residential_split": split, "flags": flags, "report": report}
    AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    for line in report:
        print(line)
    print("未通过：" + "；".join(flags) if flags else "全部 27 类与统计表对上（私人/公营在 1.5 平方公里内，其余在 1 以内）")
    print(f"-> {OUT.relative_to(ROOT)}、{AUDIT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
