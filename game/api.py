"""Web API for the playable demo: /game (the page) and /game/api/* (the engine).

The engine loads the base model once (about 10 s) on the first request and runs one play at a time in a
background worker; the page polls the job for round-by-round progress.
"""
from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Body, HTTPException, Query, Response

ROOT = Path(__file__).resolve().parents[1]
GAME_UI = ROOT / "game-ui"

router = APIRouter(prefix="/game/api", tags=["game"])

_state = {"stage": "idle", "error": None}
_lock = threading.Lock()
_jobs: dict[str, dict] = {}
_queue: queue.Queue = queue.Queue()
_layers: dict[str, bytes] = {}


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.ndarray):
        return _clean(o.tolist())
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return None if not np.isfinite(o) else float(o)
    return o


def _json(o) -> Response:
    return Response(json.dumps(_clean(o), ensure_ascii=False), media_type="application/json")


def _warm() -> None:
    try:
        from game.engine.base import get_base
        from game.engine.places import get_places
        _state["stage"] = "loading"
        get_base()
        get_places()
        _state["stage"] = "ready"
        threading.Thread(target=_worker, daemon=True).start()
        # prepare the scenario's world-without-lines in the background so the first scenario play is quick
        _queue.put(("warm-scenario", None))
    except Exception as exc:  # shown on the page
        _state["stage"] = "error"
        _state["error"] = repr(exc)


def _ensure_started() -> None:
    with _lock:
        if _state["stage"] == "idle":
            _state["stage"] = "starting"
            threading.Thread(target=_warm, daemon=True).start()


def _worker() -> None:
    from game.engine import run as R
    from game.engine.base import get_base
    from game.engine.params import Params
    from game.engine.scenario import Rates
    while True:
        job_id, payload = _queue.get()
        if job_id == "warm-scenario":
            try:
                b = get_base()
                R.reference(b, Params(), "north", Rates(b), lambda *a: None)
            except Exception:
                pass
            continue
        job = _jobs[job_id]
        job["status"] = "running"
        job["started"] = time.time()

        def progress(label, rnd, stage, info, job=job):
            event = {"label": label, "round": rnd, "stage": stage, "t": round(time.time() - job["started"], 1)}
            if stage == "road" and isinstance(info, dict):
                event.update(info)
            job["progress"].append(event)

        try:
            job["result"] = R.run(payload["design"], payload.get("scenario"), progress)
            job["status"] = "done"
        except Exception as exc:
            import traceback
            job["status"] = "error"
            job["error"] = repr(exc)
            job["trace"] = traceback.format_exc()[-2000:]


def _ready():
    _ensure_started()
    if _state["stage"] != "ready":
        raise HTTPException(status_code=503, detail=_state)


@router.get("/boot")
def boot() -> Response:
    _ensure_started()
    if _state["stage"] != "ready":
        return _json({"ready": False, **_state})
    from game.engine.base import get_base
    from game.engine.network import TYPES
    from game.engine.params import Params
    from game.engine.places import get_places
    from game.engine.scenario import DEV, SCENARIOS
    b, pl, P = get_base(), get_places(), Params()
    units = {t: {"zh": TYPES[t][0], "yi_per_km": P.value(TYPES[t][1]), "tier": P.tier(TYPES[t][1])} for t in TYPES}
    scen = {}
    for key, sc in SCENARIOS.items():
        scen[key] = {k: sc[k] for k in ("title", "story", "budget_yi", "add_residents")}
    return _json({
        "ready": True, "existing": pl.existing, "zones": pl.zones, "corridors": pl.corridors(b.peak0["P_PT"]),
        "units": units, "station_yi": P.value("G.cost_station"), "dev": DEV, "scenarios": scen,
        "layer_bounds": pl.layer_bounds(), "pt_peak_total": float(b.peak0["P_PT"].sum()),
    })


@router.get("/scenario/{key}")
def scenario_info(key: str) -> Response:
    """Where the scenario's new residents live and the main flows with them (needs the reference run)."""
    _ready()
    from game.engine import run as R
    from game.engine.base import get_base
    from game.engine.params import Params
    from game.engine.places import get_places
    from game.engine.scenario import SCENARIOS, Rates
    if key not in SCENARIOS:
        raise HTTPException(status_code=404)
    if key not in R._REF:
        return _json({"ready": False})
    b, pl = get_base(), get_places()
    ref, info = R.reference(b, Params(), key, Rates(b), lambda *a: None)
    zones = [{"label": pl.zones[b.inner.index(z["zone"])]["label"], "residents": z["residents"],
              "lon": pl.zones[b.inner.index(z["zone"])]["lon"], "lat": pl.zones[b.inner.index(z["zone"])]["lat"]}
             for z in info["zones"] if z["residents"] >= 500]
    return _json({"ready": True, "zones": zones, "corridors": pl.corridors(ref["peak"]["P_PT"])})


@router.get("/probe")
def probe(lon: float = Query(...), lat: float = Query(...)) -> Response:
    _ready()
    from game.engine.places import get_places
    return _json(get_places().probe(lon, lat))


@router.get("/segment")
def segment(lon0: float, lat0: float, lon1: float, lat1: float) -> Response:
    """Length, what the straight line crosses, and the suggested way to build it."""
    _ready()
    from game.engine.base import get_base
    from game.engine.network import suggest_type
    b = get_base()
    x0, y0 = b.to_grid.transform(lon0, lat0)
    x1, y1 = b.to_grid.transform(lon1, lat1)
    prof = b.land_profile(x0, y0, x1, y1)
    return _json({"km": float(np.hypot(x1 - x0, y1 - y0) / 1000), **prof, "suggested": suggest_type(prof)})


@router.get("/layer/{name}.png")
def layer(name: str) -> Response:
    _ready()
    if name not in ("pop", "jobs", "unserved"):
        raise HTTPException(status_code=404)
    if name not in _layers:
        from game.engine.places import get_places
        _layers[name] = get_places().layer_png(name)
    return Response(_layers[name], media_type="image/png", headers={"Cache-Control": "max-age=3600"})


@router.post("/run")
def run(payload: dict = Body(...)) -> Response:
    _ready()
    lines = payload.get("design", {}).get("lines", [])
    if not any(len([p for p in l.get("points", []) if p.get("kind", "station") == "station"]) >= 2 for l in lines):
        raise HTTPException(status_code=400, detail="至少画一条有两个车站的线")
    job_id = uuid.uuid4().hex[:10]
    _jobs[job_id] = {"status": "queued", "progress": [], "result": None, "queued_behind": _queue.qsize()}
    _queue.put((job_id, payload))
    return _json({"job": job_id})


@router.get("/job/{job_id}")
def job(job_id: str) -> Response:
    if job_id not in _jobs:
        raise HTTPException(status_code=404)
    return _json(_jobs[job_id])
