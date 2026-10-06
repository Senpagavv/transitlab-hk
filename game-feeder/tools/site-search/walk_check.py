"""Real walking check (OSM) for shortlisted feeder sites: walk distance from each estate to its station,
and for each pair of estates the walking points that are nearer than the station for both."""
import json, math, sys
import numpy as np, geopandas as gpd
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

WALK = {'footway','path','steps','pedestrian','residential','service','tertiary','secondary','primary','unclassified',
        'track','cycleway','corridor','living_street','primary_link','secondary_link','tertiary_link'}
fwd, back = Transformer.from_crs(4326, 2326, always_xy=True), Transformer.from_crs(2326, 4326, always_xy=True)
sites = json.load(open('F:/transitlab-hk/game-feeder/tools/site-search/area_search.json', encoding='utf8'))
pick = sys.argv[1:] or ['Fanling', 'Yuen Long', 'Chai Wan', 'Tai Wo', 'Kwai Hing', 'South Horizons', 'Tsing Yi']
result = {}
for site in [s for s in sites if s['station'] in pick]:
    sx, sy = site['sx'], site['sy']
    lon0, lat0 = back.transform(sx - 3500, sy - 3500); lon1, lat1 = back.transform(sx + 3500, sy + 3500)
    g = gpd.read_file('F:/transitlab-hk/data/raw/osm/hong-kong-latest.osm.pbf', layer='lines', bbox=(lon0, lat0, lon1, lat1), engine='pyogrio')
    w = g[g['highway'].isin(WALK)]
    nodes, idx, r, c, L = [], {}, [], [], []
    def nid(x, y):
        k = (round(x, 7), round(y, 7))
        if k not in idx: idx[k] = len(nodes); nodes.append(fwd.transform(x, y))
        return idx[k]
    for geom in w.geometry:
        cs = list(geom.coords)
        for (x1, y1), (x2, y2) in zip(cs, cs[1:]):
            a, b = nid(x1, y1), nid(x2, y2)
            if a != b: d = math.dist(nodes[a], nodes[b]); r += [a, b]; c += [b, a]; L += [d, d]
    XY = np.array(nodes); G = coo_matrix((L, (r, c)), shape=(len(nodes),) * 2).tocsr()
    snap = lambda x, y: int(np.argmin(np.hypot(XY[:, 0] - x, XY[:, 1] - y)))
    est = site['estates']; srcs = [snap(sx, sy)] + [snap(e['x'], e['y']) for e in est]
    D = dijkstra(G, indices=srcs); st = srcs[0]
    out = {'station': site['station'], 'estates': [], 'pairs': []}
    print(f"\n== {site['station']} ({', '.join(site['lines'])})")
    for k, e in enumerate(est, 1):
        walk = D[k][st]; out['estates'].append({**{q: e[q] for q in ['label', 'car_am', 'pop', 'km', 'bearing']}, 'walk_m': round(float(walk))})
        print(f"  {e['label']:<18s} walk {walk:6.0f} m (straight {e['km']*1000:5.0f}, ×{walk/(e['km']*1000):.2f})  car {e['car_am']}  bearing {e['bearing']}°")
    for i in range(len(est)):
        for j in range(i + 1, len(est)):
            a, b = D[i + 1], D[j + 1]
            ok = (a < a[st]) & (b < b[st]) & (a < 1600) & (b < 1600)
            if ok.any():
                sel = np.where(ok)[0]; best = sel[np.argmin(np.maximum(a[sel], b[sel]))]
                pair = (round(float(a[best])), round(float(b[best])))
            else: pair = None
            out['pairs'].append({'a': est[i]['label'], 'b': est[j]['label'], 'shared_nodes': int(ok.sum()), 'best_walks': pair})
            if ok.any(): print(f"    share {est[i]['label']} + {est[j]['label']}: {int(ok.sum())} points; most balanced walks {pair} m")
    result[site['station']] = out
json.dump(result, open('F:/transitlab-hk/game-feeder/tools/site-search/walk_check.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
