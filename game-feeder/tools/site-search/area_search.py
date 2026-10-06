"""Search every MTR station for a feeder-game setting: several estates 0.7-2.5 km away, for which this is the
nearest station, with many car commuters, and lying close enough to each other (and on the same side of the
station) that neighbouring estates can share a feeder stop. Writes F:/transitlab-hk/game-feeder/tools/site-search/area_search.json."""
import json, math, zipfile
import numpy as np, pandas as pd
from pyproj import Transformer

R = 'F:/transitlab-hk/'
to = Transformer.from_crs(4326, 2326, always_xy=True)
zc = pd.read_parquet(R + 'data/model/zone-centres.parquet').set_index('zone')
meta = {f['properties']['zone']: f['properties'] for f in json.load(open(R + 'data/web/zones-2026.geojson', encoding='utf8'))['features']}
am = np.load(R + 'data/model/am-peak-2026.npz')
zones = [str(z) for z in am['zones']]
car = dict(zip(zones, am['P_PV'].sum(1)))           # AM-peak car person-trips leaving each zone
pt = dict(zip(zones, am['P_PT'].sum(1)))

z = zipfile.ZipFile(R + 'data/raw/gtfs_merged/hk-merged.gtfs.zip')
routes = pd.read_csv(z.open('routes.txt'), dtype=str)
rail = set(routes.loc[routes['route_type'] == '1', 'route_id'])
trips = pd.read_csv(z.open('trips.txt'), dtype=str, usecols=['route_id', 'trip_id'])
trips = trips[trips['route_id'].isin(rail)]
stops = pd.read_csv(z.open('stops.txt'), dtype=str).set_index('stop_id')
times = pd.read_csv(z.open('stop_times.txt'), dtype=str, usecols=['trip_id', 'stop_id'])
times = times[times['trip_id'].isin(trips['trip_id'])].merge(trips, on='trip_id').drop_duplicates(['route_id', 'stop_id'])
times['station'] = times['stop_id'].map(lambda s: stops.at[s, 'parent_station'] if isinstance(stops.at[s, 'parent_station'], str) else s)
st = {}
for sid, grp in times.groupby('station'):
    r = stops.loc[sid]; x, y = to.transform(float(r['stop_lon']), float(r['stop_lat']))
    st[sid] = {'name': r['stop_name'], 'x': x, 'y': y, 'lines': sorted(set(grp['route_id'].str.replace('osm:MTR-', '', regex=False)))}
S = list(st); SX = np.array([[st[s]['x'], st[s]['y']] for s in S])
print(len(S), 'rail stations')

rows = []
for zid in zc.index.astype(str):
    if zid not in meta or zid not in car: continue
    x, y = zc.loc[zid if zid in zc.index else float(zid), 'x'], zc.loc[zid if zid in zc.index else float(zid), 'y']
    d = np.hypot(SX[:, 0] - x, SX[:, 1] - y); o = np.argsort(d)
    m = meta[zid]
    rows.append({'zone': zid, 'label': m['label'], 'district': m['district'], 'pop': m['population'], 'x': x, 'y': y,
                 'car': float(car[zid]), 'pt': float(pt[zid]), 'st': S[o[0]], 'd1': float(d[o[0]]), 'd2': float(d[o[1]])})
Z = pd.DataFrame(rows)
LRT = ['屯門','屯门','元朗','天水圍','天水围']  # districts with Light Rail: zones there may already have rail feeders
cand = Z[(Z.d1 >= 600) & (Z.d1 <= 3000) & (Z['pop'] >= 2000) & (Z.car >= 150)]
print(len(cand), 'zones 0.6-3 km from their nearest station with >=2000 residents and >=150 AM car trips')

def bearing(dx, dy): return math.degrees(math.atan2(dx, dy)) % 360
out = []
for sid, grp in cand.groupby('st'):
    g = grp.sort_values('car', ascending=False).head(5).reset_index(drop=True)
    if len(g) < 3: continue
    sx, sy = st[sid]['x'], st[sid]['y']
    br = [bearing(r.x - sx, r.y - sy) for r in g.itertuples()]
    share = {i: [] for i in range(len(g))}
    for i in range(len(g)):
        for j in range(i + 1, len(g)):
            dij = math.hypot(g.x[i] - g.x[j], g.y[i] - g.y[j])
            lens = g.d1[i] + g.d1[j] - dij               # width of the "nearer than the station for both" region
            if dij <= 1600 and lens >= 300: share[i].append(j); share[j].append(i)
    linked = sum(1 for v in share.values() if v)
    isolated = [g.label[i] for i, v in share.items() if not v]
    a = sorted(br); gaps = [(a[(k + 1) % len(a)] - a[k]) % 360 for k in range(len(a))]; spread = 360 - max(gaps)
    score = g.car[[i for i, v in share.items() if v]].sum() * (linked / len(g)) * (1 if spread <= 200 else .6)
    lrt = sum(1 for r in g.itertuples() if any(d in r.district for d in ['屯门','元朗']) and '站一带' in r.label)
    out.append({'lrt_zones': lrt, 'station': st[sid]['name'], 'lines': st[sid]['lines'], 'score': round(float(score)), 'spread_deg': round(spread),
                'linked': f'{linked}/{len(g)}', 'isolated': isolated,
                'sx': sx, 'sy': sy, 'estates': [{'zone': r.zone, 'x': r.x, 'y': r.y, 'label': r.label, 'district': r.district, 'pop': int(r.pop), 'car_am': round(r.car), 'pt_am': round(r.pt),
                             'km': round(r.d1 / 1000, 2), 'bearing': round(b), 'next_station_km': round(r.d2 / 1000, 2),
                             'shares_with': [g.label[j] for j in share[i]]} for i, (r, b) in enumerate(zip(g.itertuples(), br))]})
out.sort(key=lambda o: -o['score'])
json.dump(out, open('F:/transitlab-hk/game-feeder/tools/site-search/area_search.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
lp = next((k for k, o in enumerate(out) if 'Long Ping' in o['station']), None)
print('Long Ping rank:', None if lp is None else lp + 1, '/', len(out))
for k, o in enumerate(out[:14]):
    print(f"{k+1:2d}. {o['station']:<24s} score {o['score']:>6d}  spread {o['spread_deg']:>3d}°  linked {o['linked']}  isolated {o['isolated']}  LRT-area zones {o['lrt_zones']}")
    for e in o['estates']:
        print(f"     {e['label']}（{e['district']}）{e['km']} km {e['bearing']}°  car {e['car_am']}  pop {e['pop']}  shares→ {'、'.join(e['shares_with']) or '—'}")
