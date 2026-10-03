"""Data for the "aliens land at Kai Tak" demo (game-ui/alien/): zones, a 13-corridor road skeleton, rail times.

Real data: where people live (455 zones, outlying islands left out), the normal public-transport time from every
zone to Kai Tak (pipeline/18 via game.engine.base), and each corridor's capacity, lanes and normal load (v/c) from
the road network and the AM-peak assignment. Everything the game adds on top (how many want gifts, how fast news
spreads, give-up rate, bus fleet) is a game setting, tuned for play, in game-ui/alien/sim.js.

Run from the project root:  uv run python game/alien/build_data.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
OUT = ROOT / "game-ui" / "alien" / "data.js"

KT = (22.3230, 114.1995)          # Kai Tak Sports Park: where the aliens hand out gifts

# hubs of the simplified road skeleton (lat, lon)
NODES = {
    "KT": ("启德", 22.3230, 114.1995), "KLN_W": ("旺角·太子", 22.3245, 114.1700), "WK": ("西九龙", 22.3040, 114.1610),
    "HH": ("红磡", 22.3030, 114.1830), "CWB": ("铜锣湾", 22.2835, 114.1820), "CEN": ("西营盘", 22.2875, 114.1470),
    "QB": ("鲗鱼涌", 22.2860, 114.2150), "KTG": ("观塘", 22.3110, 114.2260), "DHN": ("钻石山", 22.3390, 114.1950),
    "ST": ("沙田", 22.3830, 114.1890), "TKO": ("将军澳", 22.3070, 114.2600), "TP": ("大埔", 22.4480, 114.1660),
    "FL": ("粉岭", 22.4960, 114.1390), "TW": ("荃湾", 22.3720, 114.1140), "KC": ("葵涌", 22.3570, 114.1300),
    "TM": ("屯门", 22.3920, 113.9760), "YL": ("元朗", 22.4440, 114.0280),
}
# the 13 corridors the player can act on, all directed towards Kai Tak: (name, from, to, road names in the data, speed km/h)
CORRIDORS = [
    ("红磡海底隧道", "CWB", "HH", ["CROSS HARBOUR TUNNEL"], 50),
    ("东区海底隧道", "QB", "KTG", ["EASTERN HARBOUR CROSSING"], 50),
    ("西区海底隧道", "CEN", "WK", ["WESTERN HARBOUR CROSSING"], 50),
    ("狮子山隧道", "ST", "DHN", ["LION ROCK TUNNEL ROAD"], 60),
    ("大老山隧道", "ST", "DHN", ["TATE'S CAIRN HIGHWAY"], 60),
    ("将军澳隧道", "TKO", "KTG", ["TSEUNG KWAN O TUNNEL ROAD"], 60),
    ("吐露港公路", "TP", "ST", ["TOLO HIGHWAY"], 80),
    ("屯门公路", "TM", "TW", ["TUEN MUN ROAD"], 70),
    ("葵涌道·青葵公路", "KC", "KLN_W", ["KWAI CHUNG ROAD", "TSING KWAI HIGHWAY"], 50),
    ("太子道东", "KLN_W", "KT", ["PRINCE EDWARD ROAD EAST"], 35),
    ("龙翔道", "DHN", "KT", ["LUNG CHEUNG ROAD"], 40),
    ("观塘道", "KTG", "KT", ["KWUN TONG ROAD"], 35),
    ("东九龙走廊·启德隧道", "HH", "KT", ["EAST KOWLOON CORRIDOR", "KAI TAK TUNNEL"], 45),
]
# connecting roads (not player-controlled): (name, from, to, capacity veh/h, speed, normal v/c)
CONNECTORS = [
    ("港岛北（西营盘—铜锣湾）", "CEN", "CWB", 4500, 30, 0.6), ("港岛北（铜锣湾—鲗鱼涌）", "CWB", "QB", 4500, 35, 0.6),
    ("西九龙—旺角", "WK", "KLN_W", 4000, 30, 0.6), ("龙翔道西段（旺角—钻石山）", "KLN_W", "DHN", 3000, 40, 0.5),
    ("荃湾—葵涌", "TW", "KC", 4500, 50, 0.5), ("大榄隧道（元朗—荃湾）", "YL", "TW", 4500, 80, 0.4),
    ("粉岭公路（粉岭—大埔）", "FL", "TP", 4500, 80, 0.4),
]
REGION = {"中西区": "HKI", "湾仔区": "HKI", "东区": "HKI", "南区": "HKI",
          "油尖旺区": "KLN", "深水埗区": "KLN", "九龙城区": "KLN", "黄大仙区": "KLN", "观塘区": "KLN"}
REGION_NODES = {"HKI": ["CEN", "CWB", "QB"], "KLN": ["KLN_W", "WK", "HH", "DHN", "KTG", "KT"]}
DISTRICT_NODE = {"西贡区": "TKO", "沙田区": "ST", "大埔区": "TP", "北区": "FL", "荃湾区": "TW", "葵青区": "KC",
                 "屯门区": "TM", "元朗区": "YL"}


def km(lat0, lon0, lat1, lon1):
    return float(np.hypot((lat1 - lat0) * 110.57, (lon1 - lon0) * 111.32 * np.cos(np.radians(22.35))))


def main() -> None:
    from game.engine.base import get_base
    from game.engine.places import get_places
    b, pl = get_base(), get_places()
    kx, ky = b.to_grid.transform(KT[1], KT[0])
    kt_zone = b.zone_at(kx, ky)

    links = pd.read_parquet(ROOT / "data" / "model" / "road-links.parquet",
                            columns=["link_id", "street", "capacity_ab_veh_hr", "capacity_ba_veh_hr", "lanes_ab", "lanes_ba"])
    vc = pd.read_parquet(ROOT / "data" / "model" / "assignment-am-2026.parquet", columns=["road_link", "vc"]).groupby("road_link")["vc"].max()

    edges = []
    for name, f, t, streets, speed in CORRIDORS:
        s = links[links["street"].isin(streets)]
        cap = float(s[["capacity_ab_veh_hr", "capacity_ba_veh_hr"]].max(axis=1).median())
        lanes = int(round(s[["lanes_ab", "lanes_ba"]].max(axis=1).median()))
        v = vc.reindex(s["link_id"]).dropna()
        d = km(NODES[f][1], NODES[f][2], NODES[t][1], NODES[t][2]) * 1.3
        edges.append({"name": name, "from": f, "to": t, "cap": round(cap), "lanes": max(lanes, 2), "vc": round(float(v.median()), 2),
                      "free_min": round(d / speed * 60, 1), "km": round(d, 1), "player": True, "roads": streets})
    for name, f, t, cap, speed, v in CONNECTORS:
        d = km(NODES[f][1], NODES[f][2], NODES[t][1], NODES[t][2]) * 1.3
        edges.append({"name": name, "from": f, "to": t, "cap": cap, "lanes": 3, "vc": v, "free_min": round(d / speed * 60, 1),
                      "km": round(d, 1), "player": False, "roads": []})

    zones = []
    for k, z in enumerate(pl.zones):
        if z["district"] == "离岛区" or z["pop"] < 200:
            continue
        reg = REGION.get(z["district"])
        if reg:
            cands = REGION_NODES[reg]
            node = min(cands, key=lambda n: km(z["lat"], z["lon"], NODES[n][1], NODES[n][2]))
        else:
            node = DISTRICT_NODE[z["district"]]
        acc = km(z["lat"], z["lon"], NODES[node][1], NODES[node][2]) * 1.3 / 25 * 60
        rail = float(b.cost22[k, kt_zone]) if np.isfinite(b.cost22[k, kt_zone]) else 120.0
        zones.append({"id": z["zone"], "label": z["label"], "district": z["district"], "lat": z["lat"], "lon": z["lon"],
                      "pop": z["pop"], "node": node, "access": round(min(acc, 40), 1), "pt": round(rail, 1),
                      "kt_km": round(km(z["lat"], z["lon"], *KT), 2)})

    # the two Tuen Ma line stations at Kai Tak (where the rail queue is shown)
    st = [s for s in pl.existing if s["name_zh"] in ("啟德", "宋皇臺")]
    data = {"kt": KT, "nodes": {k: {"name": v[0], "lat": v[1], "lon": v[2]} for k, v in NODES.items()}, "edges": edges,
            "zones": zones, "rail_stations": [{"name": s["name_zh"], "lat": s["lat"], "lon": s["lon"]} for s in st],
            "source": "455 分区人口（2026 基准）、各区到启德的公交时间（pipeline/18）、13 条干道的通行能力 / 车道 / 平日负荷（路网与早高峰分配）"}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("// generated by game/alien/build_data.py - do not edit\nconst ALIEN_DATA = "
                   + json.dumps(data, ensure_ascii=False) + ";\nif (typeof module !== 'undefined') module.exports = ALIEN_DATA;\n",
                   encoding="utf-8")
    print(f"{len(zones)} zones, population {sum(z['pop'] for z in zones):,}, {len(edges)} edges -> {OUT}")
    for e in edges[:13]:
        print(f"  {e['name']:12s} cap {e['cap']:5d} lanes {e['lanes']} v/c {e['vc']:.2f} free {e['free_min']} min")


if __name__ == "__main__":
    main()
