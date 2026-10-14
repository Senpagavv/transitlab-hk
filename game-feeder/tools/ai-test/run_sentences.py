"""Run the 30 fixed sentences through the level AI (backend/feeder_ai.py) and record the pass rate, latency and cost.

    uv run python game-feeder/tools/ai-test/run_sentences.py [--limit N]

Needs DEEPSEEK_API_KEY in .env (never printed). Calls the route functions directly (no server). Writes
data/cache/ai-test/<time>.json and prints a table: sentence, area picked, as expected?, attempts, ms.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")
from backend import feeder_ai  # noqa: E402


async def main(limit: int | None) -> None:
    status = await feeder_ai.status()
    if not status["ready"]:
        sys.exit("DEEPSEEK_API_KEY is not set in .env — nothing to run.")
    cases = json.loads((ROOT / "game-feeder/v7/ai/test-sentences.json").read_text(encoding="utf-8"))["sentences"][:limit]
    rows = []
    for c in cases:
        t0 = time.perf_counter()
        r = await feeder_ai.level({"sentence": c["s"], "lang": "zh-Hans"})
        ms = round((time.perf_counter() - t0) * 1000)
        if isinstance(r, dict):
            got, area = "ok", r["request"]["area"]
            attempts = r["attempts"]
        else:
            body = json.loads(r.body)
            got, area, attempts = ("refuse" if body.get("code") == "refuse" else f"fail {r.status_code}"), "", None
            r = body
        want = c.get("area")
        good = got == c["expect"] and (not want or area in (want if isinstance(want, list) else [want]))
        rows.append({"s": c["s"], "expect": c["expect"], "want_area": c.get("area"), "got": got, "area": area,
                     "good": good, "attempts": attempts, "ms": ms, "result": r})
        print(f"{'✓' if good else '✗'} {ms:5d} ms  {got:8s} {area:20s} {c['s']}")
    n = len(rows)
    summary = {"model": status["model"], "n": n, "good": sum(r["good"] for r in rows),
               "median_ms": sorted(r["ms"] for r in rows)[n // 2] if n else 0}
    out = ROOT / "data/cache/ai-test" / time.strftime("%Y%m%d-%H%M%S.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{summary['good']}/{n} as expected · median {summary['median_ms']} ms · model {summary['model']} → {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    asyncio.run(main(ap.parse_args().limit))
