"""Real walking network around Long Ping (OSM): how far does each estate really walk to the station,
what does it have to cross, and is there anywhere both the north and a south estate can reach
more easily than the station itself?"""
import json, math, sys
import numpy as np, geopandas as gpd
from pyproj import Transformer
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra

# OSM lines in a ~3 km box around Long Ping (set CPL_TMPDIR / TEMP to an ASCII folder first on this machine)
g = gpd.read_file('F:/transitlab-hk/data/raw/osm/hong-kong-latest.osm.pbf', layer='lines', bbox=(113.995, 22.425, 114.050, 22.470), engine='pyogrio')
WALK = {'footway','path','steps','pedestrian','residential','service','tertiary','secondary','primary','unclassified',
        'track','cycleway','corridor','living_street','primary_link','secondary_link','tertiary_link'}
w = g[g['highway'].isin(WALK)].copy()
mw = g[g['highway'].isin(['motorway','motorway_link','trunk','trunk_link'])]
water = g[g['waterway'].isin(['river','stream','drain','canal'])]
to = Transformer.from_crs(4326, 2326, always_xy=True)

nodes, idx, rows, cols, lens, wayname = [], {}, [], [], [], {}
def nid(x, y):
    k = (round(x, 7), round(y, 7))
    if k not in idx:
        idx[k] = len(nodes); nodes.append(to.transform(x, y))
    return idx[k]
for geom, name, hw in zip(w.geometry, w['name'], w['highway']):
    cs = list(geom.coords)
    for (x1, y1), (x2, y2) in zip(cs, cs[1:]):
        a, b = nid(x1, y1), nid(x2, y2)
        if a == b: continue
        L = math.dist(nodes[a], nodes[b])
        rows += [a, b]; cols += [b, a]; lens += [L, L]
        wayname[(min(a, b), max(a, b))] = (name, hw)
N = len(nodes); XY = np.array(nodes)
G = coo_matrix((lens, (rows, cols)), shape=(N, N)).tocsr()
print(f'walk graph: {N} nodes, {len(lens)//2} segments; motorway segments excluded: {len(mw)}')

def snap(p):
    d = np.hypot(XY[:, 0] - p[0], XY[:, 1] - p[1]); i = int(d.argmin()); return i, float(d[i])
LP = to.transform(114.025421, 22.447773)
E = {'唐人新村': (818830.48, 833186.74), '翹翠峰': (820324.07, 833217.23), '蝶翠峰': (821106.98, 833104.55), '橫洲東頭圍': (820945.62, 835625.03)}
src = {'朗屏站': LP, **E}
snapped = {k: snap(p) for k, p in src.items()}
for k, (i, d) in snapped.items(): print(f'{k}: snapped {d:.0f} m to the walk network')
names = list(src)
D, PRED = dijkstra(G, indices=[snapped[k][0] for k in names], return_predecessors=True)
dist = {k: D[n] for n, k in enumerate(names)}
st = snapped['朗屏站'][0]
report = {}
for k in E:
    walk = dist[k][st]; straight = math.dist(E[k], LP)
    print(f'{k}: walk to station {walk:.0f} m (straight {straight:.0f} m, detour ×{walk/straight:.2f})')
    report[k] = {'walk_m': round(float(walk)), 'straight_m': round(straight)}
    # what the path crosses: named ways and bridges/steps along the shortest walk
    path, n = [], st
    pred = PRED[names.index(k)]
    while n != snapped[k][0] and n >= 0:
        p = pred[n];
        if p < 0: break
        path.append(wayname.get((min(n, p), max(n, p)), (None, None))); n = p
    seen, seq = set(), []
    for nm, hw in reversed(path):
        tag = f'{nm or "(無名)"}·{hw}'
        if tag not in seen: seen.add(tag); seq.append(tag)
    print('   via:', ' → '.join(seq[:14]))
    report[k]['via'] = seq[:14]
# shared catchment: nodes that are a shorter walk than the station for both estates of a pair
def lens_len(a, b, cap=1800):
    ok = (dist[a] < dist[a][st]) & (dist[b] < dist[b][st]) & (dist[a] < cap) & (dist[b] < cap)
    if not ok.any(): return 0, None
    sel = np.where(ok)[0]; best = sel[np.argmin(np.maximum(dist[a][sel], dist[b][sel]))]
    return int(ok.sum()), (round(float(dist[a][best])), round(float(dist[b][best])), [round(v) for v in XY[best]])
for a, b in [('橫洲東頭圍','蝶翠峰'), ('橫洲東頭圍','翹翠峰'), ('橫洲東頭圍','唐人新村'), ('翹翠峰','蝶翠峰'), ('唐人新村','翹翠峰')]:
    n, best = lens_len(a, b)
    print(f'shared ({a}, {b}): {n} walk nodes nearer than the station for both; best balanced point walks {best}')
    report[f'{a}|{b}'] = {'nodes': n, 'best': best}
print('motorways nearby:', sorted(set(x for x in mw['name'].dropna()))[:10])
print('rivers/nullahs nearby:', sorted(set(x for x in water['name'].dropna()))[:12])
json.dump(report, open('F:/transitlab-hk/game-feeder/tools/site-search/walknet.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
