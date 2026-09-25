"""第 37 步：法定图则（城规会分区计划大纲图 + 发展审批地区图）→ 每个交通分区「规划上允许建什么、最多建多少」。

Input : 城规会法定规划数码资料（CSDI：tpd-tpb1-digital-planning-data-of-statutory-plans）
        每张图则一个压缩包：ZONE.json（用途地带）、BHC.json（建筑物高度管制，市区图则才有）、英文《注释》PDF
        data/web/zones-2026.geojson（455 个交通分区）
Output: data/raw/zoning/<图则编号>/{ZONE.json, BHC.json, PLAN_SCHEME_AREA.json, notes_e.pdf}
        data/raw/zoning/plans.csv                    图则清单
        data/model/zoning-2026.parquet               每块用途地带：图则、代号、面积、地积比上限及来源
        data/model/zoning-capacity.parquet           每个交通分区 × 用途大类的规划面积、按规划可建楼面
        data/web/zoning-audit.json

地积比上限：
1. 先从每张图则英文《注释》的「备注」里提取：每个用途地带一节，每一段里出现 "plot ratio" 后面的数字；
   段落里点名了某个子地带（如 "R(A)3"）就只算给它，没点名就算给整个地带；同一地带取出现过的最大值
   （即「部分住宅部分非住宅」的总上限），住宅部分单独记为 pr_domestic。
2. 提取不到的，按《香港规划标准与准则》第二章（2025 年 12 月版）表 1–3 的默认值补，并在 pr_source 里标明。
   住宅（甲类）市区 8、新市镇 6.5；（乙类）5；（丙类）3.6；（丁类）0.4；乡村式发展按整片地带折算 1.0（估计）；
   其余非住宅地带的后备值见 DEFAULT_PR；「其他指定用途」注释没写的不计楼面。
「按规划可建楼面」= 地带面积 × 地积比上限。注意这是理论上限：道路、斜坡、已建成且不会重建的楼宇都没扣。
"""
import io
import json
import re
import shutil
import subprocess
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "zoning"
OUT_ZONES = ROOT / "data" / "model" / "zoning-2026.parquet"
OUT_CAP = ROOT / "data" / "model" / "zoning-capacity.parquet"
AUDIT = ROOT / "data" / "web" / "zoning-audit.json"
PLANS = {"ozp": "https://www.ozp.tpb.gov.hk/arcgis2/rest/services/DATA/OZP_PLAN_CSDI/FeatureServer/0/query",
         "ra": "https://www.ozp.tpb.gov.hk/arcgis2/rest/services/DATA/RA_PLAN_CSDI/FeatureServer/1/query"}
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"}
PDFTOTEXT = shutil.which("pdftotext") or "C:/Program Files/Git/mingw64/bin/pdftotext.exe"   # Git for Windows 自带

# 市区（《标准与准则》表 1 的范围）：港岛、九龙、荃湾、葵涌、青衣
URBAN_PREFIXES = ("S/H", "S/K", "S/TW", "S/KC", "S/TY")

# 用途地带 → 大类（算容量用）
GROUPS = {
    "R(A)": "residential", "R(B)": "residential", "R(C)": "residential", "R(D)": "residential", "R(E)": "residential",
    "V": "village", "C": "commercial", "CDA": "mixed", "OU": "other_specified", "I": "industrial", "I(D)": "industrial",
    "OS": "open_storage", "G/IC": "government", "O": "open_space", "REC": "recreation", "GB": "green_belt",
    "CA": "conservation", "CPA": "conservation", "SSSI": "conservation", "CP": "country_park", "AGR": "agriculture",
    "U": "undetermined", "U(A)": "undetermined", "R(A)": "residential",
}
# 《标准与准则》第二章表 1–3（住宅）；非住宅地带的后备值取常见图则注释的典型上限（仅在提取不到时用）
# 乡村式发展：注释一般只限 3 层（8.23 米）不写地积比；表 3 的 3.0 是单个地盘的重建上限，整片地带（含小路、空地）
# 按小型屋宇 3 层、约三分之一面积可建折算为 1.0（估计）。「其他指定用途」没写地积比的多是机场、港口、车厂，不计楼面。
DEFAULT_PR = {"R(A)": (8.0, 6.5), "R(B)": (5.0, 5.0), "R(C)": (3.6, 3.6), "R(D)": (0.4, 0.4), "R(E)": (5.0, 5.0),
              "V": (1.0, 1.0), "C": (12.0, 9.5), "CDA": (5.0, 5.0), "I": (12.0, 9.5), "I(D)": (1.6, 1.6)}
NO_PRIVATE_FLOOR = {"G/IC", "O", "REC", "GB", "CA", "CPA", "SSSI", "CP", "AGR", "U", "U(A)", "OS", "CPA", "SI"}

# 《注释》里每一节的标题 → 地带代号
HEADINGS = [
    (r"RESIDENTIAL \(GROUP A\)", "R(A)"), (r"RESIDENTIAL \(GROUP B\)", "R(B)"), (r"RESIDENTIAL \(GROUP C\)", "R(C)"),
    (r"RESIDENTIAL \(GROUP D\)", "R(D)"), (r"RESIDENTIAL \(GROUP E\)", "R(E)"), (r"VILLAGE TYPE DEVELOPMENT", "V"),
    (r"COMPREHENSIVE DEVELOPMENT AREA", "CDA"), (r"COMMERCIAL", "C"), (r"OTHER SPECIFIED USES", "OU"),
    (r"INDUSTRIAL \(GROUP D\)", "I(D)"), (r"INDUSTRIAL", "I"), (r"GOVERNMENT, INSTITUTION OR COMMUNITY", "G/IC"),
    (r"OPEN SPACE", "O"), (r"RECREATION", "REC"), (r"GREEN BELT", "GB"), (r"CONSERVATION AREA", "CA"),
    (r"COASTAL PROTECTION AREA", "CPA"), (r"SITE OF SPECIAL SCIENTIFIC INTEREST", "SSSI"), (r"AGRICULTURE", "AGR"),
    (r"OPEN STORAGE", "OS"), (r"UNDETERMINED", "U"),
]


def get(url: str, params: dict | None = None, attempts: int = 5) -> httpx.Response:
    for attempt in range(attempts):
        try:
            r = httpx.get(url, params=params, headers=HEADERS, timeout=300, follow_redirects=True)
            r.raise_for_status()
            return r
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(5 * (attempt + 1))


def plan_list() -> pd.DataFrame:
    rows = []
    for kind, url in PLANS.items():
        payload = get(url, {"where": "1=1", "outFields": "*", "returnGeometry": "false", "f": "json"}).json()
        assert "features" in payload, f"图则清单查询失败：{payload}"
        for f in payload["features"]:
            a = f["attributes"]
            link = a.get("GEOJSON_LINK") or ""
            plan = a.get("PLAN_NO") or httpx.QueryParams(link.split("?", 1)[-1]).get("planNo")
            rows.append({"PLAN_NO": plan, "NAME_ENG": a.get("NAME_ENG"), "NAME_CHT": a.get("NAME_CHT"), "GEOJSON_LINK": link, "kind": kind})
    return pd.DataFrame(rows)


def download(plan: dict) -> str:
    folder = RAW / plan["PLAN_NO"].replace("/", "_")
    if (folder / "ZONE.json").exists():
        return "cached"
    z = zipfile.ZipFile(io.BytesIO(get(plan["GEOJSON_LINK"]).content))
    folder.mkdir(parents=True, exist_ok=True)
    for name in z.namelist():
        base = name.rsplit("/", 1)[-1]
        if base in ("ZONE.json", "BHC.json", "PLAN_SCHEME_AREA.json"):
            (folder / base).write_bytes(z.read(name))
        elif base.lower().endswith("_e.pdf"):
            (folder / "notes_e.pdf").write_bytes(z.read(name))
        elif base == "Data Dictionary.pdf" and not (RAW / "Data Dictionary.pdf").exists():
            (RAW / "Data Dictionary.pdf").write_bytes(z.read(name))
    return "downloaded"


def esri_to_gdf(path: Path, plan_no: str):
    """城规会的 ZONE.json 是 Esri JSON（香港 1980 方格网），转成 GeoDataFrame。"""
    import geopandas as gpd
    from shapely.geometry import Polygon
    from shapely.ops import unary_union
    from shapely.validation import make_valid
    d = json.loads(path.read_bytes().decode("utf-8", "ignore"))
    geoms, attrs = [], []
    for f in d.get("features", []):
        rings = f.get("geometry", {}).get("rings") or []
        if not rings:
            continue
        # Esri：顺时针为外环、逆时针为洞
        outer = [make_valid(Polygon(r)) for r in rings if len(r) >= 4 and _clockwise(r)]
        holes = [make_valid(Polygon(r)) for r in rings if len(r) >= 4 and not _clockwise(r)]
        if not outer:
            continue
        g = unary_union(outer)
        if holes:
            g = g.difference(unary_union(holes))
        geoms.append(g)
        attrs.append(f.get("attributes", {}))
    df = pd.DataFrame(attrs)
    df["PLAN_NO"] = plan_no
    return gpd.GeoDataFrame(df, geometry=geoms, crs=2326)


def _clockwise(ring: list) -> bool:
    return sum((x2 - x1) * (y2 + y1) for (x1, y1), (x2, y2) in zip(ring, ring[1:])) > 0


def base_label(label: str) -> str:
    s = (label or "").strip().upper().replace(" ", "")
    for key in ("R(A)", "R(B)", "R(C)", "R(D)", "R(E)", "I(D)", "G/IC", "CDA", "CPA", "SSSI", "REC", "AGR", "OU", "GB", "CA",
                "OS", "CP", "V", "C", "I", "O", "U"):
        if s.startswith(key):
            return key
    return s or "?"


NUM = re.compile(r"(?<![\d(])(\d{1,2}(?:\.\d{1,3})?)(?![\d)])")


def notes_plot_ratios(pdf: Path) -> dict:
    """{地带或子地带代号: (最高地积比, 住宅部分地积比或 None)}，从英文《注释》备注里提取。"""
    if not pdf.exists():
        return {}
    text = subprocess.run([PDFTOTEXT, "-layout", str(pdf), "-"], capture_output=True).stdout.decode("utf-8", "ignore")
    text = text.split("EXPLANATORY STATEMENT")[0]
    lines = text.splitlines()
    # 找每一节的标题行（整行只有大写标题，可带 "(Cont'd)"）
    marks = []
    for k, line in enumerate(lines):
        s = line.strip().replace("(Cont'd)", "").replace("(cont'd)", "").strip()
        for pat, lab in HEADINGS:
            if re.fullmatch(pat, s):
                marks.append((k, lab))
                break
    out: dict = {}
    for m, (start, lab) in enumerate(marks):
        end = marks[m + 1][0] if m + 1 < len(marks) else len(lines)
        body = "\n".join(lines[start:end])
        if "Remarks" not in body:
            continue
        remarks = body.split("Remarks", 1)[1]
        paras = re.split(r"\n\s*\((?=\d{1,2}\)|[a-z]\))", remarks)
        for para in paras:
            flat = " ".join(para.split())
            if "plot ratio" not in flat.lower():
                continue
            named = re.findall(r'\("([A-Z/()0-9]{1,12})"\)|"([A-Z]{1,4}\([A-Z0-9]{1,3}\)\d{0,2}|[A-Z/]{1,5}\d{0,2}(?:\(\d+\))?)"', flat)
            names = {a or b for a, b in named if (a or b)}
            names = {n for n in names if base_label(n) == lab} or {lab}
            nums, dom = [], []
            # 常见句式：「… in excess of 8.5 for a domestic building or 9.0 for a building that is partly domestic …」
            for m in re.finditer(r"([\d.]+) for a domestic building or ([\d.]+) for a building that is partly domestic", flat):
                a, b = float(m.group(1)), float(m.group(2))
                if 0.1 <= a <= 20 and 0.1 <= b <= 20:
                    dom.append(a)
                    nums.append(b)
            # 其余：每次出现 plot ratio 只取紧跟着的第一个数；碰到句号、分号或高度/上盖/楼面面积等别的限制就停
            # （9/25 第一版把同一句里的「18 层」也当成地积比，丙类住宅中位数提成了 5）
            for hit in re.finditer(r"plot ratio", flat, flags=re.I):
                window = flat[hit.end(): hit.end() + 120]
                window = re.split(r";|\. |building height|site coverage|storey|metre|mPD|m2|m²|gross floor area|GFA|paragraph|whichever",
                                  window)[0]
                found = NUM.findall(window)
                if not found:
                    continue
                x = float(found[0])
                if not 0.1 <= x <= 20:
                    continue
                nums.append(x)
                around = flat[max(0, hit.start() - 25): hit.end() + window.find(found[0]) + 40].lower()
                if "domestic" in around.replace("non-domestic", ""):
                    dom.append(x)
            if not nums:
                continue
            for name in names:
                pmax, pdom = out.get(name, (0.0, None))
                pmax = max(pmax, max(nums))
                if dom:
                    pdom = min(dom) if pdom is None else min(pdom, min(dom))
                out[name] = (pmax, pdom)
    return out


def main() -> None:
    import geopandas as gpd
    report: list[str] = []
    RAW.mkdir(parents=True, exist_ok=True)
    plans = plan_list()
    plans.to_csv(RAW / "plans.csv", index=False, encoding="utf-8-sig")
    with ThreadPoolExecutor(4) as pool:
        status = list(pool.map(download, plans.to_dict("records")))
    report.append(f"图则 {len(plans)} 张（分区计划大纲图 {int((plans['kind'] == 'ozp').sum())}、另 {int((plans['kind'] == 'ra').sum())} 张）；"
                  f"本次下载 {status.count('downloaded')}，已有 {status.count('cached')}")

    parts, parsed_plans, no_zones = [], 0, []
    for p in plans.to_dict("records"):
        folder = RAW / p["PLAN_NO"].replace("/", "_")
        if not (folder / "ZONE.json").exists():   # 「规管地区图」（RA/…）只有一个管制范围，没有用途地带
            no_zones.append(p["PLAN_NO"])
            continue
        g = esri_to_gdf(folder / "ZONE.json", p["PLAN_NO"])
        prs = notes_plot_ratios(folder / "notes_e.pdf")
        parsed_plans += bool(prs)
        urban = p["PLAN_NO"].startswith(URBAN_PREFIXES)
        labels = g["ZONE_LABEL"].fillna("").astype(str).str.strip()
        g["zone_label"] = labels
        g["zone_base"] = labels.map(base_label)
        pr, dom, src = [], [], []
        for lab, base in zip(labels, g["zone_base"]):
            if lab in prs:
                v, d = prs[lab]; s = "注释（子地带）"
            elif base in prs:
                v, d = prs[base]; s = "注释（地带）"
            elif base in DEFAULT_PR and base not in NO_PRIVATE_FLOOR:
                v = DEFAULT_PR[base][0 if urban else 1]; d = v if base in ("R(A)", "R(B)", "R(C)", "R(D)", "R(E)", "V") else None
                s = "标准与准则默认"
            else:
                v, d, s = 0.0, None, "不计私人楼面"
            pr.append(v); dom.append(d); src.append(s)
        g["pr_max"], g["pr_domestic"], g["pr_source"], g["urban"] = pr, dom, src, urban
        parts.append(g[["PLAN_NO", "zone_label", "zone_base", "DESC_ENG", "pr_max", "pr_domestic", "pr_source", "urban", "geometry"]])
    zon = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=2326)
    zon = zon[zon.geometry.notna() & ~zon.geometry.is_empty]
    zon["area_ha"] = zon.geometry.area / 1e4
    zon["group"] = zon["zone_base"].map(GROUPS).fillna("other")
    zon["floor_cap_m2"] = zon.geometry.area * zon["pr_max"]
    report.append(f"用途地带 {len(zon):,} 块、{zon['area_ha'].sum() / 100:.0f} 平方公里；{parsed_plans} 张图则的《注释》提取到地积比；"
                  f"没有用途地带的图则 {len(no_zones)} 张（{'、'.join(no_zones)}，规管地区图，只有管制范围）")

    # 覆盖检查：图则之间不应重叠太多（新旧版本或边界）
    union = zon.geometry.union_all() if hasattr(zon.geometry, "union_all") else zon.geometry.unary_union
    overlap = zon["area_ha"].sum() - union.area / 1e4
    report.append(f"各图则合起来覆盖 {union.area / 1e6:.0f} 平方公里（重叠 {overlap / 100:.1f} 平方公里）")

    # 地积比来源统计（按住宅 / 商业类面积）
    dev = zon[zon["pr_max"] > 0]
    by_src = dev.groupby("pr_source")["area_ha"].sum()
    report.append("有私人楼面的地带按面积：" + "；".join(f"{k} {v / dev['area_ha'].sum() * 100:.0f}%" for k, v in by_src.items()))
    stats = {}
    for base in ("R(A)", "R(B)", "R(C)", "R(D)", "R(E)", "V", "C", "CDA", "OU", "I"):
        s = zon[(zon["zone_base"] == base) & (zon["pr_source"] != "标准与准则默认") & (zon["pr_max"] > 0)]
        if len(s):
            stats[base] = {"n": int(len(s)), "median": float(s["pr_max"].median()), "p10": float(s["pr_max"].quantile(0.1)),
                           "p90": float(s["pr_max"].quantile(0.9)), "area_ha": float(s["area_ha"].sum())}
    report.append("从注释提取的地积比（中位 / 10%–90%）：" + "；".join(
        f"{k} {v['median']:.1f}（{v['p10']:.1f}–{v['p90']:.1f}，{v['n']} 块）" for k, v in stats.items()))

    zon.to_crs(4326).to_parquet(OUT_ZONES)

    # 汇总到交通分区
    zones = gpd.read_file(ROOT / "data" / "web" / "zones-2026.geojson").to_crs(2326)[["zone", "geometry"]]
    inter = gpd.overlay(zon[["group", "zone_base", "pr_max", "pr_domestic", "geometry"]], zones, how="intersection", keep_geom_type=True)
    inter["area_m2"] = inter.geometry.area
    inter["floor_cap_m2"] = inter["area_m2"] * inter["pr_max"]
    dom_pr = inter["pr_domestic"].fillna(0.0)
    inter["dom_cap_m2"] = np.where(inter["group"].isin(["residential", "village"]), inter["area_m2"] * np.where(dom_pr > 0, dom_pr, inter["pr_max"]),
                                   np.where(inter["group"] == "mixed", inter["area_m2"] * inter["pr_max"] * 0.5, 0.0))
    area = inter.pivot_table(index="zone", columns="group", values="area_m2", aggfunc="sum", fill_value=0) / 1e4
    area.columns = [f"ha_{c}" for c in area.columns]
    cap = inter.groupby("zone").agg(floor_cap_m2=("floor_cap_m2", "sum"), domestic_cap_m2=("dom_cap_m2", "sum"))
    table = zones[["zone"]].set_index("zone").join(area).join(cap).fillna(0.0).reset_index()
    table["zoned_ha"] = table.filter(like="ha_").sum(axis=1)
    zone_area = zones.set_index("zone").geometry.area / 1e4
    covered = table.set_index("zone")["zoned_ha"] / zone_area
    report.append(f"交通分区被法定图则覆盖的比例：中位 {covered.median() * 100:.0f}%，完全没有图则的分区 {int((covered < 0.05).sum())} 个"
                  "（多为郊野公园、离岛，本来就不在图则范围）")
    table.to_parquet(OUT_CAP, index=False)

    # 与现有楼面比：按规划的住宅容量 vs 现在的住宅楼面（第 10 步的住宅判定）
    flags = []
    try:
        blds = pd.read_parquet(ROOT / "data" / "raw" / "buildings" / "buildings-classified.parquet", columns=["zone", "gfa_m2", "dwelling"])
        now = blds[blds["dwelling"]].groupby("zone")["gfa_m2"].sum()
        both = table.set_index("zone")["domestic_cap_m2"].to_frame().join(now.rename("dwelling_gfa_m2")).fillna(0)
        ratio = both["domestic_cap_m2"].sum() / both["dwelling_gfa_m2"].sum()
        report.append(f"按规划的住宅楼面上限 {both['domestic_cap_m2'].sum() / 1e6:.0f} 百万平方米，现有住宅楼面 "
                      f"{both['dwelling_gfa_m2'].sum() / 1e6:.0f} 百万平方米（比值 {ratio:.2f}）")
        if not 0.8 <= ratio <= 3.0:
            flags.append(f"规划住宅容量 / 现有住宅楼面 = {ratio:.2f}，超出 0.8–3.0 的合理带")
    except Exception as e:  # 楼宇表缺列时不阻断
        report.append(f"未能与现有住宅楼面对比：{e}")

    if parsed_plans < 0.6 * (len(plans) - len(no_zones)):
        flags.append(f"只有 {parsed_plans}/{len(plans) - len(no_zones)} 张图则提取到地积比")
    # 合理性：从注释提取的地积比中位数应落在这些带里（《标准与准则》第二章与常见图则注释）
    bands = {"R(A)": (5, 12), "R(B)": (2, 7), "R(C)": (0.4, 4), "R(D)": (0.2, 2), "V": (1, 4), "C": (5, 15), "CDA": (1, 12)}
    for base, (lo, hi) in bands.items():
        if base in stats and not lo <= stats[base]["median"] <= hi:
            flags.append(f"{base} 提取的地积比中位 {stats[base]['median']:.1f} 不在 {lo}–{hi}")
    high = zon[zon["zone_base"].isin(["R(A)", "R(B)", "R(C)", "R(D)", "V"]) & (zon["pr_max"] > 15)]
    if len(high):
        flags.append(f"{len(high)} 块住宅/乡村地带的地积比超过 15")
    audit = {"source": "城规会法定规划数码资料（CSDI）；后备地积比：《香港规划标准与准则》第二章 2025 年 12 月版",
             "plans": int(len(plans)), "parsed_plans": int(parsed_plans), "pr_by_zone_type": stats,
             "flags": flags, "report": report}
    AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    for line in report:
        print(line)
    print("未通过：" + "；".join(flags) if flags else "全部检查通过")
    print(f"-> {OUT_ZONES.relative_to(ROOT)}、{OUT_CAP.relative_to(ROOT)}、{AUDIT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
