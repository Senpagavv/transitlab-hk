"""Build the MapLibre style for the Lands Department vector basemap (with Traditional Chinese labels).

Input : Lands Department Vector Map API + Vector Map Label API (free, no key)
        https://portal.csdi.gov.hk/csdi-webpage/apidoc/VectorMapAPI
        Terms: show the Lands Department logo and "Map from Lands Department" on the map;
        avoid large numbers of requests in a short period.
Output: frontend/public/basemap/hk-vector-style.json  (served by the dev server, loaded by the map)
        The frontend fetches every URL below through the backend's disk cache (/api/basemap/...).

Why vector instead of raster tiles: raster tiles take ~0.8 s each, and while they load MapLibre
stretches the previous zoom level's images (big blurry text). Vector tiles are redrawn sharply at
every zoom, and tiles only exist up to zoom 15 (deeper zooms re-use that data).

Street level (zoom 13+): every zoom band of this service uses different source-layers
(1:200k, 1:50k, 1:10k data), so while new tiles load nothing from the old zoom can stand in. The
full-cover "3_HydroPolyMask" water layer flashed the whole screen blue there, so above zoom 13 it is
off and not-yet-loaded areas simply show a light land-coloured background (the frontend's zoom
transition covers them with the previous picture). Below zoom 13 a label-free raster basemap and the
water mask stay, because the mask also paints the sea outside Hong Kong where the vector data has no fill.

Run from the project root:
    uv run python pipeline/02_build_basemap_style.py
"""

import json
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "frontend" / "public" / "basemap" / "hk-vector-style.json"

VT = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/vt"
BASE = f"{VT}/basemap/WGS84"
LABEL = f"{VT}/label/hk/tc/WGS84"
USER_AGENT = "TransitLabHK/0.1 (student hackathon prototype)"

# The API documents tiles for zoom 9-15 (zoom 16+ returns 204). Declaring maxzoom 15 makes
# MapLibre reuse zoom-15 data when zoomed further in instead of requesting empty tiles.
TILE_MINZOOM = 9
TILE_MAXZOOM = 15
ATTRIBUTION = "© Map from Lands Department"

RASTER_PLACEHOLDER_TILES = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png"
RASTER_PLACEHOLDER_MAXZOOM = 13
# Full-cover water layer that flashed the screen blue after a fast zoom (see module docstring).
WATER_MASK_LAYER = "3_HydroPolyMask"
STREET_LEVEL_ZOOM = 13
BACKGROUND_COLOR = "rgb(243, 244, 236)"  # same land tone as the frontend's transition backdrop


def fetch_style(client: httpx.Client, base_url: str) -> dict:
    resp = client.get(f"{base_url}/resources/styles/root.json")
    resp.raise_for_status()
    return resp.json()


def retarget(layers: list[dict], source_id: str, id_prefix: str = "") -> list[dict]:
    out = []
    for layer in layers:
        layer = {**layer, "id": f"{id_prefix}{layer['id']}"}
        if "source" in layer:
            layer["source"] = source_id
        out.append(layer)
    return out


def check_symbol_fonts(layers: list[dict]) -> list[str]:
    """Symbol layers that draw text must name a font, otherwise MapLibre requests a font the server lacks."""
    return [
        layer["id"]
        for layer in layers
        if layer["type"] == "symbol"
        and "text-field" in layer.get("layout", {})
        and not layer.get("layout", {}).get("text-font")
    ]


def build() -> dict:
    with httpx.Client(timeout=30, headers={"User-Agent": USER_AGENT}) as client:
        base = fetch_style(client, BASE)
        label = fetch_style(client, LABEL)

    base_layers = [dict(layer) for layer in base["layers"]]
    masks = [layer for layer in base_layers if layer["id"] == WATER_MASK_LAYER]
    if len(masks) != 1:
        raise SystemExit(f"Expected one {WATER_MASK_LAYER} layer; the upstream style has changed, re-check it")
    masks[0]["maxzoom"] = STREET_LEVEL_ZOOM

    background = {"id": "background", "type": "background", "paint": {"background-color": BACKGROUND_COLOR}}
    placeholder = {
        "id": "placeholder-raster",
        "type": "raster",
        "source": "landsd-raster-placeholder",
        "maxzoom": STREET_LEVEL_ZOOM,
        "paint": {"raster-resampling": "linear", "raster-fade-duration": 0},
    }
    layers = (
        [background, placeholder]
        + retarget(base_layers, "landsd-base")
        + retarget(label["layers"], "landsd-label", "label/")
    )
    missing_fonts = check_symbol_fonts(layers)
    if missing_fonts:
        raise SystemExit(f"Symbol layers without text-font: {missing_fonts[:5]}")

    return {
        "version": 8,
        "name": "Lands Department vector basemap + TC labels",
        # Only the basemap style uses icons; the label style has none.
        "sprite": f"{BASE}/resources/sprites/sprite",
        # Chinese label fonts live under the label service; the frontend redirects "Arial Regular"
        # (used by a few basemap layers) to the basemap service, see transformRequest in basemap.ts.
        "glyphs": f"{LABEL}/resources/fonts/{{fontstack}}/{{range}}.pbf",
        "sources": {
            "landsd-raster-placeholder": {
                "type": "raster",
                "tiles": [RASTER_PLACEHOLDER_TILES],
                "tileSize": 256,
                "maxzoom": RASTER_PLACEHOLDER_MAXZOOM,
            },
            "landsd-base": {
                "type": "vector",
                "tiles": [f"{BASE}/tile/{{z}}/{{y}}/{{x}}.pbf"],
                "minzoom": TILE_MINZOOM,
                "maxzoom": TILE_MAXZOOM,
                "attribution": ATTRIBUTION,
            },
            "landsd-label": {
                "type": "vector",
                "tiles": [f"{LABEL}/tile/{{z}}/{{y}}/{{x}}.pbf"],
                "minzoom": TILE_MINZOOM,
                "maxzoom": TILE_MAXZOOM,
            },
        },
        "layers": layers,
    }


def main() -> None:
    style = build()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(style, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    fonts = sorted({f for l in style["layers"] for f in l.get("layout", {}).get("text-font", [])})
    print(f"Wrote {OUTPUT.relative_to(ROOT)}: {len(style['layers'])} layers, {OUTPUT.stat().st_size / 1024:.0f} KB")
    print("fonts used:", fonts)


if __name__ == "__main__":
    main()
