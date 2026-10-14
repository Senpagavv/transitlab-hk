"""The sandbox's clean base map: real shapes instead of the 400 m mosaic (2026-10-15).

Reads data/web/zones-2026.geojson and data/model/road-links + road-nodes (read only) and writes
game-feeder/v7/hk/hk-shapes.json, everything in the grid's own units (one unit = one 400 m cell, the same as
hk-base.json: x = (E - 800000) / 400, y = (850000 - N) / 400), so the sandbox draws it with the same camera:
  zones      455 zone outlines (id, district, rings), simplified to ~25 m
  districts  18 district outlines and a point for each name
  coast      the land's outline
  roads      expressway and primary road links, [x1, y1, x2, y2, class] (0 expressway, 1 primary)
Run: uv run python game-feeder/tools/hk-grid/build_shapes.py
"""
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'game-feeder' / 'v7' / 'hk' / 'hk-shapes.json'
X0, YTOP, CELL = 800000, 850000, 400
u = lambda x, y: [round((x - X0) / CELL, 3), round((YTOP - y) / CELL, 3)]


def rings(geom, tol):
    g = geom.simplify(tol, preserve_topology=True)
    polys = list(g.geoms) if isinstance(g, MultiPolygon) else [g] if isinstance(g, Polygon) else []
    out = []
    for p in polys:
        if p.area < 400 * 400 * 0.02:           # specks under ~3,000 m²
            continue
        out.append([u(x, y) for x, y in p.exterior.coords])
    return out


z = gpd.read_file(ROOT / 'data' / 'web' / 'zones-2026.geojson').to_crs(2326)
zones = [{'id': str(r.zone), 'd': r.district, 'rings': rings(r.geometry, 25)} for r in z.itertuples()]
districts = []
for d, g in z.groupby('district'):
    shape = unary_union(list(g.geometry))
    p = shape.representative_point() if shape.area else shape.centroid
    big = max(shape.geoms, key=lambda q: q.area) if isinstance(shape, MultiPolygon) else shape
    districts.append({'name': d, 'rings': rings(shape, 60), 'label': u(*big.representative_point().coords[0])})
coast = rings(unary_union(list(z.geometry)), 40)

links = pd.read_parquet(ROOT / 'data' / 'model' / 'road-links.parquet', columns=['road_class', 'a_node', 'b_node'])
nodes = pd.read_parquet(ROOT / 'data' / 'model' / 'road-nodes.parquet').set_index('node_id')
keep = links[links.road_class.isin(['expressway', 'primary'])]
a, b = nodes.loc[keep.a_node], nodes.loc[keep.b_node]
roads = [[*u(x1, y1), *u(x2, y2), 0 if c == 'expressway' else 1]
         for x1, y1, x2, y2, c in zip(a.x.values, a.y.values, b.x.values, b.y.values, keep.road_class.values)]

# the railways as they run (OpenStreetMap, data/raw/osm), coloured by line: the MTR, Light Rail, the high-speed rail.
# GDAL reads the .pbf (set CPL_TMPDIR to a plain-ASCII folder on a machine with a non-ASCII user name).
COLOURS = [('East Rail', '#53B7E8'), ('Tuen Ma', '#923011'), ('Airport Express', '#00888A'), ('Tung Chung', '#F38B00'),
           ('Tseung Kwan O', '#7D499D'), ('Kwun Tong', '#00AB4E'), ('Tsuen Wan', '#ED1D24'), ('South Island', '#BAC429'),
           ('Island Line', '#007DC5'), ('Disneyland', '#F173AC'), ('Lantau and Airport', '#F38B00'), ('Light Rail', '#D3A809'),
           ('High Speed', '#8C8C8C')]
osm = gpd.read_file(ROOT / 'data' / 'raw' / 'osm' / 'hong-kong-latest.osm.pbf', layer='lines', columns=['name', 'railway', 'other_tags'])
osm = osm[osm.railway.isin(['subway', 'rail', 'light_rail']) & ~osm.other_tags.fillna('').str.contains('"service"=>', regex=False)].to_crs(2326)
rail = []
for name, kind, geom in zip(osm.name.fillna(''), osm.railway, osm.geometry):
    colour = next((c for key, c in COLOURS if key in name), None)
    if not colour or geom is None:
        continue
    g = geom.simplify(8)
    parts = list(g.geoms) if g.geom_type == 'MultiLineString' else [g]
    for p in parts:
        rail.append({'c': colour, 'k': {'subway': 0, 'rail': 0, 'light_rail': 1}[kind] if 'High Speed' not in name else 2,
                     'pts': [u(x, y) for x, y in p.coords]})

out = {'version': 1, 'units': '400 m cells from (800000, 850000) HK1980',
       'source': 'data/web/zones-2026.geojson; data/model/road-links, road-nodes; data/raw/osm/hong-kong-latest.osm.pbf (railways, © OpenStreetMap contributors)',
       'zones': zones, 'districts': districts, 'coast': coast, 'roads': roads, 'rail': rail}
OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
print(OUT, f'{OUT.stat().st_size // 1024} KB', len(zones), 'zones', len(districts), 'districts', len(roads), 'road links', len(rail), 'rail pieces')
