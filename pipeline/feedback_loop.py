"""Go round demand and congestion until they agree: 27b -> 23 -> 24 -> 27, then check.

Round 1 starts from the current assignment (made with free-flow car times) with 27b --reset; each later
round averages the new delay into the old (27b). After each round 27b --check measures whether the delay
the assignment now produces is within 5% of the delay mode choice was given; if so, stop.
Goods (26) and the bus preload (25) do not depend on mode choice and are not rerun.

Each step's full output is kept in data/cache/feedback/round<k>-<step>.txt.
Run from the project root (about 10 minutes a round, up to 5 rounds):
    uv run python pipeline/feedback_loop.py
Afterwards: pipeline/39, diagnose_corridors, audit.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGS = ROOT / "data" / "cache" / "feedback"
AUDIT = ROOT / "data" / "web" / "congestion-feedback-audit.json"
MAX_ROUNDS = 5


def run(step: str, k: int, *args: str) -> None:
    t0 = time.time()
    out = LOGS / f"round{k}-{step}{''.join(a.strip('-') for a in args)}.txt"
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    with out.open("w", encoding="utf-8") as f:
        code = subprocess.run([sys.executable, str(ROOT / "pipeline" / f"{step}.py"), *args], cwd=ROOT, env=env,
                              stdout=f, stderr=subprocess.STDOUT).returncode
    print(f"  {step} {' '.join(args)}：{time.time() - t0:.0f} 秒", flush=True)
    if code != 0:
        raise SystemExit(f"{step} 失败（退出码 {code}），见 {out}")
    if step in ("27_road_assignment", "27b_congested_skim"):
        for line in out.read_text(encoding="utf-8").splitlines():
            if any(key in line for key in ("GEH（", "走廊", "核心站按车种", "核对", "第 ")) and "it/s" not in line:
                print("    " + line.strip()[:170], flush=True)


def main() -> None:
    LOGS.mkdir(parents=True, exist_ok=True)
    for k in range(1, MAX_ROUNDS + 1):
        print(f"== 第 {k} 轮", flush=True)
        run("27b_congested_skim", k, *(["--reset"] if k == 1 else []))
        run("23_mode_choice", k)
        run("24_peak_hour", k)
        run("27_road_assignment", k)
        run("27b_congested_skim", k, "--check")
        if json.loads(AUDIT.read_text(encoding="utf-8"))["settled"]:
            print(f"已稳定（{k} 轮）", flush=True)
            return
    print(f"跑满 {MAX_ROUNDS} 轮仍未稳定，见 {AUDIT.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
