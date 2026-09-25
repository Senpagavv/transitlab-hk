"""第 38 步：地价（差饷物业估价署）→ 每个交通分区的住宅楼价、租金水平和商铺/写字楼租值指数。

Input : 差饷物业估价署《估价册及地租登记册统计摘要》表 7–10（2026 年 4 月 1 日，按 18 区）
        差饷物业估价署《物业市场统计》1.1A / 1.2A（私人住宅各类平均租金、售价，按港岛/九龙/新界，年度）
                                     2.1A / 2.2A（写字楼按地区）、3.1A（商铺按港岛/九龙/新界）
Output: data/raw/rvd/summary_statistics_table_{7,8,9,10}.csv、market_{1.1A,1.2A,2.1A,2.2A,3.1A}.csv
        data/model/property-values-2026.parquet   每个交通分区（按所在区）一行
        data/web/property-values-audit.json

怎么从「应课差饷租值」换成「每平方米楼价」：
  应课差饷租值 ≈ 一年的市值租金。表 7 按区、按面积类别（A、B 类 < 70 平方米；C 类 70–99.9；D、E 类 ≥ 100）
  给出单位数和总租值 → 每区每类的「每单位平均年租值」。同一类别里单位面积相近，所以
      区的楼价（元/平方米）= 所在大区该类平均楼价（1.2A）×（区的每单位年租值 ÷ 大区的每单位年租值）
  大区 = 港岛 / 九龙 / 新界（含离岛），与 1.1A、1.2A 的分区一致。面积是实用面积。
  回报率 = 平均租金 × 12 ÷ 平均售价（1.1A ÷ 1.2A），用来核对。
这只到「区」一级（18 个区），区内不再细分；交通分区继承所在区的数值。
用途：修地铁、修路之后的「站旁地价上涨」要乘在这个楼价上。
"""
import io
import json
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "rvd"
OUT = ROOT / "data" / "model" / "property-values-2026.parquet"
AUDIT = ROOT / "data" / "web" / "property-values-audit.json"
BASE = "https://www.rvd.gov.hk/datagovhk/"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"}
YEAR = 2025   # 物业市场统计最近一个完整年度

DISTRICTS = {  # 英文 → 交通分区里的写法，以及所属大区
    "Central and Western": ("中西区", "Hong Kong"), "Wan Chai": ("湾仔区", "Hong Kong"), "Eastern": ("东区", "Hong Kong"),
    "Southern": ("南区", "Hong Kong"), "Yau Tsim Mong": ("油尖旺区", "Kowloon"), "Sham Shui Po": ("深水埗区", "Kowloon"),
    "Kowloon City": ("九龙城区", "Kowloon"), "Wong Tai Sin": ("黄大仙区", "Kowloon"), "Kwun Tong": ("观塘区", "Kowloon"),
    "Kwai Tsing": ("葵青区", "New Territories"), "Tsuen Wan": ("荃湾区", "New Territories"), "Tuen Mun": ("屯门区", "New Territories"),
    "Yuen Long": ("元朗区", "New Territories"), "North": ("北区", "New Territories"), "Tai Po": ("大埔区", "New Territories"),
    "Sha Tin": ("沙田区", "New Territories"), "Sai Kung": ("西贡区", "New Territories"), "Islands": ("离岛区", "New Territories"),
}
CLASSES = {"A & B": ("A", "B"), "C": ("C",), "D & E": ("D", "E")}


def fetch(name: str, local: str) -> pd.DataFrame:
    """下载（只读来源），存一份原样的，再读成表。第一行是标题，第二行才是表头。"""
    body = httpx.get(BASE + name, headers=HEADERS, timeout=120).content
    (RAW / local).write_bytes(body)
    return pd.read_csv(io.BytesIO(body), skiprows=1, encoding="utf-8-sig", thousands=",", na_values=["-", "n/a", "- "])


def main() -> None:
    report: list[str] = []
    RAW.mkdir(parents=True, exist_ok=True)
    rv = fetch("summary_statistics_table_7.csv", "summary_statistics_table_7.csv")
    shop = fetch("summary_statistics_table_8.csv", "summary_statistics_table_8.csv")
    office = fetch("summary_statistics_table_9.csv", "summary_statistics_table_9.csv")
    factory = fetch("summary_statistics_table_10.csv", "summary_statistics_table_10.csv")
    price = fetch("1.2A(from_99).csv", "market_1.2A.csv")
    rent = fetch("1.1A(from_99).csv", "market_1.1A.csv")
    for name in ("2.1A(from_99).csv", "2.2A(from_99).csv", "3.1A(from_99).csv"):
        fetch(name, "market_" + name.split("(")[0] + ".csv")

    for t in (rv, shop, office, factory):
        t["District"] = t["District"].astype(str).str.strip()
    year_row = lambda t: t[t["Year"].astype(str).str.strip() == str(YEAR)].iloc[0]
    p, r = year_row(price), year_row(rent)

    # 大区 × 类别的平均楼价、租金（A&B 等按两类的简单平均）
    def region_value(row, cls, region):
        vals = [float(row[f"Class {c} {region}"]) for c in CLASSES[cls]]
        return float(np.mean(vals))

    rows, flags = [], []
    for eng, (cn, region) in DISTRICTS.items():
        d = rv[rv["District"] == eng].iloc[0]
        reg = rv[rv["District"] == region].iloc[0]
        out = {"district": cn, "district_en": eng, "region": region}
        num_total, val_total = 0.0, 0.0
        for cls in CLASSES:
            n = float(d[f"Classes {cls} - Number"] if f"Classes {cls} - Number" in d else d[f"Class {cls} - Number"])
            v = float(d[f"Classes {cls} - Rateable Value ($'000)"] if f"Classes {cls} - Number" in d else d[f"Class {cls} - Rateable Value ($'000)"]) * 1000
            rn = float(reg[f"Classes {cls} - Number"] if f"Classes {cls} - Number" in reg else reg[f"Class {cls} - Number"])
            rvv = float(reg[f"Classes {cls} - Rateable Value ($'000)"] if f"Classes {cls} - Number" in reg else reg[f"Class {cls} - Rateable Value ($'000)"]) * 1000
            key = cls.replace(" & ", "")
            out[f"units_{key}"] = n
            out[f"rv_per_unit_{key}"] = v / n if n else np.nan
            rel = (v / n) / (rvv / rn) if n and rn else np.nan
            out[f"price_m2_{key}"] = region_value(p, cls, region) * rel
            out[f"rent_m2_{key}"] = region_value(r, cls, region) * rel
            num_total += n; val_total += v
        # 区的住宅平均楼价：按单位数加权
        w = np.array([out[f"units_{c.replace(' & ', '')}"] for c in CLASSES])
        pr = np.array([out[f"price_m2_{c.replace(' & ', '')}"] for c in CLASSES])
        rt = np.array([out[f"rent_m2_{c.replace(' & ', '')}"] for c in CLASSES])
        ok = np.isfinite(pr) & (w > 0)
        out["dom_price_m2"] = float((pr[ok] * w[ok]).sum() / w[ok].sum())
        out["dom_rent_m2_month"] = float((rt[ok] * w[ok]).sum() / w[ok].sum())
        out["dom_units"] = num_total
        out["dom_rv_per_unit"] = val_total / num_total
        s = shop[shop["District"] == eng].iloc[0]
        o = office[office["District"] == eng].iloc[0]
        f = factory[factory["District"] == eng].iloc[0]
        out["shop_rv_per_unit"] = float(s["Shop - Rateable Value ($'000)"]) * 1000 / float(s["Shop - Number"])
        out["office_units"] = float(o["Office - Number"]) if pd.notna(o["Office - Number"]) else 0.0
        out["office_rv_per_unit"] = (float(o["Office - Rateable Value ($'000)"]) * 1000 / out["office_units"]) if out["office_units"] else np.nan
        num_cols = [c for c in f.index if c.endswith("- Number")]
        out["factory_storage_units"] = float(np.nansum([pd.to_numeric(f[c], errors="coerce") for c in num_cols]))
        rows.append(out)
    table = pd.DataFrame(rows)
    table["gross_yield"] = table["dom_rent_m2_month"] * 12 / table["dom_price_m2"]

    # 核对 1：按单位数加权回到大区，应接近 1.2A 的大区平均（按类别构造，所以主要检查加权方式没出错）
    for region in ("Hong Kong", "Kowloon", "New Territories"):
        sub = table[table["region"] == region]
        est = (sub["price_m2_AB"] * sub["units_AB"]).sum() / sub["units_AB"].sum()
        official = region_value(p, "A & B", region)
        report.append(f"{region} A/B 类楼价：各区加权 {est:,.0f} 元/平方米，统计 {official:,.0f}（{est / official - 1:+.1%}）")
        if abs(est / official - 1) > 0.10:
            flags.append(f"{region} 各区加权楼价与统计相差超过 10%")
    # 核对 2：回报率应在 2%–6%
    bad = table[(table["gross_yield"] < 0.02) | (table["gross_yield"] > 0.06)]
    if len(bad):
        flags.append("回报率超出 2%–6%：" + "、".join(bad["district"]))
    top = table.sort_values("dom_price_m2", ascending=False)
    report.append("住宅楼价（元/平方米实用）最高：" + "、".join(f"{d} {v:,.0f}" for d, v in zip(top["district"][:4], top["dom_price_m2"][:4]))
                  + "；最低：" + "、".join(f"{d} {v:,.0f}" for d, v in zip(top["district"][-3:], top["dom_price_m2"][-3:])))
    report.append(f"回报率 {table['gross_yield'].min():.1%}–{table['gross_yield'].max():.1%}")

    zones = json.loads((ROOT / "data" / "web" / "zones-2026.geojson").read_text(encoding="utf-8"))
    z = pd.DataFrame([{"zone": f["properties"]["zone"], "district": f["properties"]["district"]} for f in zones["features"]])
    out = z.merge(table, on="district", how="left")
    missing = int(out["dom_price_m2"].isna().sum())
    if missing:
        flags.append(f"{missing} 个交通分区没对上区")
    out.to_parquet(OUT, index=False)
    audit = {"source": f"差饷物业估价署：估价册统计摘要表 7–10（2026-04-01）、物业市场统计 {YEAR} 年度",
             "districts": table[["district", "region", "dom_price_m2", "dom_rent_m2_month", "gross_yield", "shop_rv_per_unit",
                                 "office_rv_per_unit"]].round(3).to_dict("records"),
             "flags": flags, "report": report}
    AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=1), encoding="utf-8")
    for line in report:
        print(line)
    print("未通过：" + "；".join(flags) if flags else "全部检查通过")
    print(f"-> {OUT.relative_to(ROOT)}、{AUDIT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
