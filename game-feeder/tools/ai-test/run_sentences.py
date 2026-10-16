"""60-sentence acceptance harness. Default: fixed chat replies, no key/network/.env reads.

Claude alone runs --live; the launching environment supplies credentials.
Scores returned requests, not playable levels. Raw model replies are saved for review.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from backend import feeder_ai  # noqa: E402

CHECKS = ("outcome", "mode", "area", "changes", "no_extra", "title_length", "period", "notes")


def load_names() -> dict:
    """Share the browser's exact menu builder, including road aliases and clipping."""
    result = subprocess.run(["node", str(HERE / "export_names.js"), str(ROOT / "game-feeder/v7/hk/hk-base.json")],
                            check=True, capture_output=True, encoding="utf-8")
    return json.loads(result.stdout)


def unpack(result):
    body = result if isinstance(result, dict) else json.loads(result.body)
    if "request" in body:
        return "ok", body["request"], body
    outcome = "refuse" if body.get("code") == "refuse" else "unavailable" if body.get("code") == "area_empty" else "fail"
    return outcome, {}, body


def options(value):
    return value if isinstance(value, list) else [value]


def identity_matches(actual, expected):
    return actual.get("place") in options(expected.get("place")) and actual.get("what") == expected.get("what")


def change_matches(actual, expected):
    if not identity_matches(actual, expected):
        return False
    if "by_year_range" in expected:
        if not expected["by_year_range"][0] <= actual.get("by_year", 0) <= expected["by_year_range"][1]:
            return False
    elif actual.get("by_year", 0) != expected.get("by_year", 0):
        return False
    if "add" in expected:
        return actual.get("add") == expected["add"] and "pct" not in actual
    if "pct" in expected:
        return actual.get("pct") == expected["pct"] and "add" not in actual
    if "pct_range" in expected:
        lo, hi = expected["pct_range"]
        return type(actual.get("pct")) in (int, float) and lo <= actual["pct"] <= hi and "add" not in actual
    return False


def match_all(actual, expected, matcher):
    # At most four changes. Backtracking handles overlapping alternatives without order sensitivity.
    if not actual:
        return True
    return any(matcher(actual[0], e) and match_all(actual[1:], expected[:i] + expected[i + 1:], matcher)
               for i, e in enumerate(expected))


def score_case(case, result):
    got, request, body = unpack(result)
    checks = dict.fromkeys(CHECKS)
    checks["outcome"] = got == case["expect"]
    if case["expect"] == "ok":
        checks["mode"] = got == "ok" and request.get("mode") == case["mode"]
        checks["area"] = got == "ok" and request.get("area") in options(case["area"])
        actual, expected = request.get("changes", []), case["changes"]
        valid = isinstance(actual, list) and all(isinstance(c, dict) for c in actual)
        checks["changes"] = got == "ok" and valid and len(actual) == len(expected) and match_all(actual, expected, change_matches)
        checks["no_extra"] = got == "ok" and valid and match_all(actual, expected, identity_matches)
        title = request.get("title", "")
        length = len(re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", title)) if case.get("lang") == "en" else len(title)
        checks["title_length"] = got == "ok" and 4 <= length <= 10
        if "period" in case:
            checks["period"] = got == "ok" and request.get("period") == case["period"]
    if case.get("notes_hint"):
        notes = " ".join(map(str, body.get("notes", []))) + " " + str(body.get("message", ""))
        checks["notes"] = bool(re.search(case["notes_hint"], notes))
    return {"checks": checks, "good": all(v is not False for v in checks.values()),
            "got": got, "mode": request.get("mode"), "area": request.get("area"), "result": body}


def table(rows):
    mark = lambda v: "—" if v is None else "✓" if v else "✗"
    escape = lambda v: str(v).replace("|", "\\|").replace("\n", " ")
    lines = ["|编号|结果|玩法|片区|改动一致|无多加|标题长度|耗时 ms|句子|", "|---|---|---|---|---|---|---|---:|---|"]
    for row in rows:
        c = row["checks"]
        values = [row["id"], mark(row["good"]) + " " + row["got"], mark(c["mode"]) + " " + str(row["mode"] or "—"),
                  mark(c["area"]) + " " + str(row["area"] or "—"), mark(c["changes"]), mark(c["no_extra"]),
                  mark(c["title_length"]), row["ms"], row["s"]]
        lines.append("|" + "|".join(map(escape, values)) + "|")
    return "\n".join(lines)


async def run(*, live=False, limit=None, repeat=1, replies_path=None, out=None):
    cases = json.loads((ROOT / "game-feeder/v7/ai/test-sentences.json").read_text(encoding="utf-8"))["sentences"][:limit]
    if not cases:
        raise ValueError("no test sentences")
    names, original_chat = load_names(), feeder_ai.chat
    if live:
        status = await feeder_ai.status()
        if not status["ready"]:
            raise RuntimeError("Live credentials must be supplied by the launching environment; this script never reads .env.")
        fixed = None
    else:
        status = {"model": "fixed-replies (offline)"}
        fixed = json.loads((replies_path or HERE / "canned-replies.json").read_text(encoding="utf-8"))
    rows = []
    try:
        for round_no in range(1, repeat + 1):
            for case in cases:
                raw_replies = []
                queue = None if live else options(fixed[case["id"]]).copy()

                async def recorded_chat(messages, **kwargs):
                    if live:
                        reply = await original_chat(messages, **kwargs)
                    else:
                        if not queue:
                            raise RuntimeError(f"fixed replies exhausted for {case['id']}; no live fallback")
                        reply = queue.pop(0)
                        reply = json.dumps(reply, ensure_ascii=False) if isinstance(reply, dict) else reply
                    raw_replies.append(reply)
                    return reply

                feeder_ai.chat = recorded_chat
                payload = {"sentence": case["s"], "lang": case.get("lang", "zh-Hans"), "names": names}
                if case.get("requested_mode") is not None:
                    payload["mode"] = case["requested_mode"]
                t0 = time.perf_counter()
                response = await feeder_ai.level(payload)
                row = {"id": case["id"], "round": round_no, "s": case["s"], "expected": case,
                       **score_case(case, response), "ms": round((time.perf_counter() - t0) * 1000), "raw_replies": raw_replies}
                row["attempts"] = row["result"].get("attempts", len(raw_replies))
                rows.append(row)
    finally:
        feeder_ai.chat = original_chat
    n = len(rows)
    summary = {"kind": "live" if live else "offline-fixed-replies", "model": status["model"], "n": n,
               "good": sum(r["good"] for r in rows), "median_ms": statistics.median(r["ms"] for r in rows),
               "checks": {k: {"pass": sum(r["checks"][k] is True for r in rows), "n": sum(r["checks"][k] is not None for r in rows)} for k in CHECKS},
               "warning": "Fixed replies verify the harness only, not live AI quality." if not live else
                          "Request-level acceptance only. Playable levels and natural titles need separate review."}
    variants = {}
    for row in rows:
        req = row["result"].get("request", {})
        selection = {k: req.get(k) for k in ("mode", "area")}
        selection["outcome"] = row["got"]
        selection["changes"] = sorted(req.get("changes", []), key=lambda c: json.dumps(c, sort_keys=True, ensure_ascii=False))
        signature = json.dumps(selection, ensure_ascii=False, sort_keys=True)
        variants.setdefault(row["id"], set()).add(signature)
    summary["unstable_cases"] = [key for key, values in variants.items() if len(values) > 1]
    output = {"summary": summary, "rows": rows}
    destination = out or HERE / "results" / (time.strftime("%Y%m%d-%H%M%S") + ("-live" if live else "-offline"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    json_path, md_path = destination.with_suffix(".json"), destination.with_suffix(".md")
    json_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(f"{summary['kind']} · {summary['good']}/{n} · {summary['warning']}\n\n" + table(rows) + "\n", encoding="utf-8")
    print(table(rows))
    print(f"\n{summary['good']}/{n} · {summary['kind']} · median {summary['median_ms']} ms → {json_path}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--live", action="store_true", help="Claude only: explicitly allow real AI requests")
    modes.add_argument("--offline", action="store_true", help="fixed replies (default)")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--replies", type=Path)
    parser.add_argument("--out", type=Path, help="output stem; writes .json and .md")
    args = parser.parse_args()
    if args.repeat < 1 or (args.limit is not None and args.limit < 1):
        parser.error("--repeat and --limit must be positive")
    if args.live and args.replies:
        parser.error("--replies is offline only")
    asyncio.run(run(live=args.live, limit=args.limit, repeat=args.repeat, replies_path=args.replies, out=args.out))
