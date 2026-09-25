"""Check that the Python, geospatial and Java toolchain works on this machine.

Run from the project root:
    uv run python pipeline/00_check_env.py
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def geo_stack() -> str:
    import geopandas
    import pyogrio
    import pyproj
    import shapely

    return (
        f"geopandas {geopandas.__version__}, pyogrio {pyogrio.__version__}, "
        f"pyproj {pyproj.__version__}, shapely {shapely.__version__}"
    )


def hk80_transform() -> str:
    from pyproj import Transformer

    # HK 1980 Grid false origin; WGS84 differs from the HK80 datum by a few hundred metres.
    to_wgs84 = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True)
    lon, lat = to_wgs84.transform(836694.05, 819069.80)
    assert abs(lon - 114.1786) < 0.005 and abs(lat - 22.3121) < 0.005, (lon, lat)
    return f"HK80 origin -> lon {lon:.5f}, lat {lat:.5f}"


def java_home() -> str:
    home = os.environ.get("JAVA_HOME", "")
    if not (Path(home) / "bin" / "java.exe").exists():
        raise FileNotFoundError(f"java.exe not found under JAVA_HOME={home!r} (check .env)")
    return home


def r5py_jvm() -> str:
    import r5py  # starts the JVM and downloads the R5 jar on first run

    return f"r5py {r5py.__version__}"


CHECKS = [
    ("Python", lambda: sys.version.split()[0]),
    ("Geospatial stack", geo_stack),
    ("HK1980 -> WGS84 conversion", hk80_transform),
    ("JAVA_HOME", java_home),
    ("r5py + Java", r5py_jvm),
]


def main() -> int:
    failures = 0
    for label, fn in CHECKS:
        try:
            print(f"[OK]   {label}: {fn()}")
        except Exception as exc:  # report every check instead of stopping at the first
            failures += 1
            print(f"[FAIL] {label}: {exc!r}")
    print("All checks passed." if not failures else f"{failures} check(s) failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
