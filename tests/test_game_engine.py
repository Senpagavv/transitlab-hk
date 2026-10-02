"""The playable demo's engine (game/engine): nothing built must give back the validated 2026 base exactly,
and a new line must behave sensibly. Loads the base model once (about 10 s)."""
import numpy as np
import pytest

from game.engine import network, run, transit
from game.engine.base import get_base
from game.engine.params import Params


@pytest.fixture(scope="module")
def base():
    return get_base()


LINE = {"lines": [{"name": "t", "headway_min": 4, "points": [
    {"lon": 114.0632, "lat": 22.4347}, {"lon": 114.0860, "lat": 22.4960}, {"lon": 114.1279, "lat": 22.5014}]}]}


def test_nothing_built_is_the_base(base):
    out = run.solve(base, Params(), None, base.ends.copy(), "zero", lambda *a: None, rounds=1)
    for k in base.split0:
        assert np.abs(out["mode"][k] - base.mode_file[k]).max() < 1e-6, k
    for k in out["peak"]:
        assert np.abs(out["peak"][k] - base.peak0[k]).max() < 1e-6, k
    assert np.array_equal(out["road"]["vol"], base.road["vol"])
    finite = np.isfinite(base.delay23)
    assert np.abs(out["delay"][finite] - base.delay23[finite]).max() < 1e-9


def test_running_time_and_construction():
    assert network.run_minutes(3000) == pytest.approx((3000 / (80 / 3.6) + (80 / 3.6)) / 60)
    assert network.run_minutes(200) < network.run_minutes(400) < network.run_minutes(3000)
    assert network.suggest_type({"water": 0.3, "hill": 0, "urban": 0}) == "tunnel"
    assert network.suggest_type({"water": 0, "hill": 0.1, "urban": 0.2}) == "viaduct"


def test_line_snaps_to_existing_stations_and_saves_time(base):
    P = Params()
    net = network.build(LINE, base, P)
    assert net.stations[0]["existing"] and net.stations[-1]["existing"]      # Kam Sheung Road, Sheung Shui
    assert not net.stations[1]["existing"]
    paths = network.Paths(net, base, P)
    tr = transit.assign(paths, base.peak0["P_PT"], base.cost22, P.value("D.route_split_per_min"), iterations=2)
    assert tr["trips"] > 1000
    assert (tr["share"] >= 0).all() and (tr["share"] <= 1).all()
    assert np.allclose(np.diag(tr["share"]), 0)
    ok = (tr["share"] > 0.5) & np.isfinite(base.cost22)       # (5 base pairs have no transit time at all)
    assert (tr["T"][ok] <= base.cost22[ok] + 1e-9).all()                     # riders mostly where it is faster
    cost = network.cost(net, P)
    assert cost["total"] > 0 and cost["tier"] == "D"                          # provisional unit costs
