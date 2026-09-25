"""Local disk cache in front of the Lands Department basemap services (vector tiles, fonts, sprites).

From this network the government server needs ~0.8-1.7 s per vector tile, and one zoom step needs
dozens of them. A cached file is served from disk in milliseconds and keeps working offline (for
example at the pitch venue). Only the basemap paths used by our map style are passed through.
"""

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

import httpx

UPSTREAM = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/"
USER_AGENT = "TransitLabHK/0.1 (student hackathon prototype)"
ALLOWED_PREFIXES = ("vt/basemap/WGS84/", "vt/label/hk/tc/WGS84/", "xyz/basemap/wgs84/")
MEDIA_TYPES = {".pbf": "application/x-protobuf", ".png": "image/png", ".json": "application/json"}
EMPTY_SUFFIX = ".empty"  # marker for "the server has no data here" (HTTP 204)


@dataclass
class BasemapFile:
    content: bytes
    media_type: str
    empty: bool
    from_cache: bool


class BasemapCache:
    def __init__(self, cache_dir: Path, client: httpx.AsyncClient | None = None):
        self.cache_dir = Path(cache_dir).resolve()
        self._client = client or httpx.AsyncClient(
            http2=True,
            timeout=30,
            headers={"User-Agent": USER_AGENT},
            limits=httpx.Limits(max_connections=32),
        )

    def local_path(self, path: str) -> Path:
        if not path.startswith(ALLOWED_PREFIXES) or ".." in path.split("/") or "\\" in path:
            raise ValueError(f"Not a basemap path: {path!r}")
        target = (self.cache_dir / path).resolve()
        if self.cache_dir not in target.parents:
            raise ValueError(f"Not a basemap path: {path!r}")
        return target

    async def get(self, path: str) -> BasemapFile:
        target = self.local_path(path)
        media_type = MEDIA_TYPES.get(target.suffix, "application/octet-stream")
        empty_marker = target.with_name(target.name + EMPTY_SUFFIX)

        if target.exists():
            return BasemapFile(target.read_bytes(), media_type, empty=False, from_cache=True)
        if empty_marker.exists():
            return BasemapFile(b"", media_type, empty=True, from_cache=True)

        resp = await self._client.get(UPSTREAM + path)
        if resp.status_code == 204:
            _write_atomic(empty_marker, b"")
            return BasemapFile(b"", media_type, empty=True, from_cache=False)
        resp.raise_for_status()
        _write_atomic(target, resp.content)
        return BasemapFile(resp.content, media_type, empty=False, from_cache=False)

    async def aclose(self) -> None:
        await self._client.aclose()


def _write_atomic(target: Path, content: bytes) -> None:
    """Write via a temporary file so a half-written tile is never served."""
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=target.parent, suffix=".part")
    with os.fdopen(fd, "wb") as f:
        f.write(content)
    os.replace(tmp, target)
