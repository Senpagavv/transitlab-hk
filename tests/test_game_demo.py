"""game-demo（修桥、画地铁的小游戏）的浏览器代码，用 Node 跑：海、水塘这些不可通行区域的边界守不守得住。"""
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "game-demo"


@pytest.mark.skipif(shutil.which("node") is None, reason="没装 Node.js")
@pytest.mark.skipif(not (GAME / "data-land.js").exists(), reason="先跑 game-demo/build_data.py")
def test_game_demo_passability():
    run = subprocess.run(["node", "--test", str(GAME / "tests" / "passability.test.js")], cwd=ROOT,
                         capture_output=True, text=True, encoding="utf-8", timeout=900)
    assert run.returncode == 0, run.stdout[-4000:] + run.stderr[-2000:]
