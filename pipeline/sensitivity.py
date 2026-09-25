"""One-at-a-time ±20% sensitivity study for assignment and fleet parameters.

Run from the project root with: .venv/Scripts/python.exe -B pipeline/sensitivity.py
Only this script, data/web/sensitivity-audit.json, and backups under
data/cache/sensitivity/ are created. The two outputs of pipeline/27 are
temporarily replaced, then regenerated at default settings in the last run.
"""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
ASSIGNMENT = ROOT / "data/model/assignment-am-2026.parquet"
ASSIGNMENT_AUDIT = ROOT / "data/web/assignment-audit.json"
DUTY_AUDIT = ROOT / "data/web/duty-audit.json"
DUTY_TABLE = ROOT / "data/model/duty-scenarios.parquet"
OUTPUT = ROOT / "data/web/sensitivity-audit.json"
CACHE = ROOT / "data/cache/sensitivity"
SWEEP = (8_000, 10_000, 12_000, 14_000, 17_695)
UNTESTED = [
    {"parameter": "mode-choice time sensitivity", "source": "pipeline/23_mode_choice.py",
     "reason": "fitted within step 23; perturbing requires rebuilding mode choice and downstream steps"},
    {"parameter": "taxi fare weight", "source": "pipeline/23_mode_choice.py",
     "reason": "fitted within step 23; perturbing requires rebuilding mode choice and downstream steps"},
    {"parameter": "time scale r", "source": "pipeline/22_trip_distribution.py",
     "reason": "fitted within step 22; perturbing requires rebuilding trip distribution and downstream steps"},
    {"parameter": "harbour factor K", "source": "pipeline/22_trip_distribution.py",
     "reason": "fitted within step 22; perturbing requires rebuilding trip distribution and downstream steps"},
    {"parameter": "goods time scale rho", "source": "pipeline/26_goods_and_boundary_vehicles.py",
     "reason": "fitted within step 26; perturbing requires rebuilding goods demand and assignment"},
    {"parameter": "goods harbour factor", "source": "pipeline/26_goods_and_boundary_vehicles.py",
     "reason": "fitted within step 26; perturbing requires rebuilding goods demand and assignment"},
]


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def backup_current(folder: Path, label: str) -> dict:
    """Back up both current outputs before EVERY step-27 invocation."""
    target = folder / label
    target.mkdir()
    saved = {}
    for source in (ASSIGNMENT, ASSIGNMENT_AUDIT):
        if not source.is_file() or source.stat().st_size == 0:
            raise RuntimeError(f"missing or empty before 27: {source}")
        copy = target / source.name
        shutil.copy2(source, copy)
        if not copy.is_file() or copy.stat().st_size == 0:
            raise RuntimeError(f"backup missing or empty: {copy}")
        saved[source.name] = {"path": str(copy.relative_to(ROOT)), "bytes": copy.stat().st_size,
                              "sha256": digest(copy)}
    print(f"备份完成：{label}；两个文件均非空", flush=True)
    return saved


def run_assignment(folder: Path, label: str, parameter: str | None = None,
                   value: float | None = None) -> dict:
    saved = backup_current(folder, label)
    env = os.environ.copy()
    env.pop("TOLL_WEIGHT", None)
    env.pop("TAXI_TOLL_WEIGHT", None)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    if parameter is not None:
        env[parameter] = str(value)
    print(f"运行 27：{label}；{parameter or '默认参数'}={value if parameter else '默认'}", flush=True)
    subprocess.run([sys.executable, "-B", str(ROOT / "pipeline/27_road_assignment.py")],
                   cwd=ROOT, env=env, check=True)
    return saved


def assignment_metrics() -> dict:
    data = json.loads(ASSIGNMENT_AUDIT.read_text(encoding="utf-8"))
    ratios = {key: float(value) for key, value in data["per_class_ratio"].items()}
    worst = max(ratios, key=lambda key: abs(ratios[key] - 1))
    return {"corridor_geh_under_5": float(data["corridor_geh_under_5"]),
            "max_class_ratio_deviation": abs(ratios[worst] - 1),
            "worst_class": worst, "worst_class_ratio": ratios[worst],
            "per_class_ratio": ratios}


def load_duty():
    spec = importlib.util.spec_from_file_location("duty_sensitivity", ROOT / "pipeline/35_duty_and_charging.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fleet_baselines(duty) -> dict:
    audit = json.loads(DUTY_AUDIT.read_text(encoding="utf-8"))
    table = pd.read_parquet(DUTY_TABLE)
    found = {rule: (None if (size := duty.smallest(table, rule)) is None else int(size))
             for rule in ("不休息", "司机换更", "电动充电")}
    expected = {key: int(value) if value is not None else None
                for key, value in audit["smallest_fleet"].items()}
    if found != expected or found["不休息"] != 12_000:
        raise RuntimeError(f"35 baseline disagrees with its audit or 12,000 floor: {found} vs {expected}")
    return found


def fleet_variant(duty, parameter: str, value: float, data: tuple, zones: int) -> int | None:
    """Use 35's own simulator and qualification test; never call its writing main()."""
    setattr(duty, parameter, value)
    if parameter == "AV_RANGE_KM":
        rule, settings = "电动充电", {"range_km": duty.AV_RANGE_KM,
                                      "recharge_min": duty.AV_RECHARGE_MIN}
    else:
        rule, settings = "司机换更", {"break_min": duty.TAXI_BREAK_MIN}
    tables = []
    for size in SWEEP:
        print(f"35 {parameter}={value:g}：{size:,} 辆", flush=True)
        tables.append(duty.run(rule, size, settings, data, zones))
    size = duty.smallest(pd.concat(tables, ignore_index=True), rule)
    return None if size is None else int(size)


def record(parameter: str, default: float, value: float, before: dict, after: dict,
           fleet_before: int | None, fleet_after: int | None, rule: str) -> dict:
    b, a = before["corridor_geh_under_5"], after["corridor_geh_under_5"]
    bc, ac = before["max_class_ratio_deviation"], after["max_class_ratio_deviation"]
    return {
        "parameter": parameter, "default": default, "perturbed": value,
        "change_pct": (value / default - 1) * 100, "fleet_rule": rule,
        "before": {"corridor_geh_under_5": b, "max_class_ratio_deviation": bc,
                   "worst_class": before["worst_class"], "fleet_min": fleet_before},
        "after": {"corridor_geh_under_5": a, "max_class_ratio_deviation": ac,
                  "worst_class": after["worst_class"], "fleet_min": fleet_after},
        "delta": {"corridor_geh_percentage_points": (a - b) * 100,
                  "max_class_ratio_deviation": ac - bc,
                  "fleet_vehicles": None if fleet_before is None or fleet_after is None
                  else fleet_after - fleet_before},
    }


def red_flags(rows: list[dict]) -> list[dict]:
    flags = []
    for row in rows:
        reasons = []
        if abs(row["delta"]["corridor_geh_percentage_points"]) > 10:
            reasons.append("走廊 GEH<5 变化超过 10 个百分点")
        if row["before"]["fleet_min"] != row["after"]["fleet_min"]:
            reasons.append("最小达标车队跨档")
        if row["before"]["worst_class"] != row["after"]["worst_class"]:
            reasons.append("最大车种偏离的车种发生变化")
        if reasons:
            flags.append({"marker": "🔴", "parameter": row["parameter"],
                          "perturbed": row["perturbed"], "reasons": reasons})
    return flags


def print_summary(audit: dict) -> None:
    rows = audit["perturbations"]
    print("\n敏感性表（GEH 为百分点、车种偏离为比值单位、车队为辆）：", flush=True)
    for row in rows:
        b, a, d = row["before"], row["after"], row["delta"]
        print(f"{row['parameter']} {row['perturbed']:g} [{row['fleet_rule']}] | "
              f"GEH {b['corridor_geh_under_5']:.4f}→{a['corridor_geh_under_5']:.4f} "
              f"({d['corridor_geh_percentage_points']:+.2f}pp) | "
              f"车种偏离 {b['max_class_ratio_deviation']:.4f}→{a['max_class_ratio_deviation']:.4f} "
              f"({d['max_class_ratio_deviation']:+.4f}) | "
              f"车队 {b['fleet_min']}→{a['fleet_min']} ({d['fleet_vehicles']})", flush=True)
    for flag in audit["red_flags"]:
        print(f"\x1b[31m[RED] {flag['parameter']}={flag['perturbed']:g}："
              f"{'；'.join(flag['reasons'])}\x1b[0m", flush=True)
    print("本次未扰动的参数及原因：", flush=True)
    for item in audit["untested_parameters"]:
        print(f"  {item['parameter']} ({item['source']}): {item['reason']}", flush=True)
    print(f"验收检查：{audit['checks']}", flush=True)
    print(f"产出已复位：走廊 GEH<5 = {audit['restore']['after'] * 100:.16g}%", flush=True)


def main() -> None:
    if OUTPUT.exists():
        raise RuntimeError("sensitivity-audit.json already exists; refusing to overwrite it")
    for path in (ASSIGNMENT, ASSIGNMENT_AUDIT, DUTY_AUDIT, DUTY_TABLE):
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"missing or empty prerequisite: {path}")
    original = assignment_metrics()
    raw_audit = json.loads(ASSIGNMENT_AUDIT.read_text(encoding="utf-8"))
    if raw_audit["toll_weight"] != 0.20 or raw_audit["class_toll_weight"] != {}:
        raise RuntimeError("current assignment is not the calibrated default")
    duty = load_duty()
    fleets = fleet_baselines(duty)
    folder = CACHE / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    folder.mkdir(parents=True)
    initial = backup_current(folder, "00-original")
    backups, rows = {"00-original": initial}, []
    failure = None
    try:
        backups["01-preflight-default"] = run_assignment(folder, "01-preflight-default")
        if assignment_metrics()["corridor_geh_under_5"] != original["corridor_geh_under_5"]:
            raise RuntimeError("preflight default run failed exact corridor reset check")
        print("预检通过：默认参数重跑后的走廊 GEH<5 与原值完全相等", flush=True)

        # Step 35 reads fixed requests and measured detector speeds, not step 27 output.
        # Its scans therefore leave the default assignment metrics unchanged.
        base = duty.base_module()
        report = []
        requests, minutes, kilometres, zones = base.load(report)
        data = (requests, minutes, kilometres, base.slowdown())
        for parameter, default, values, rule in (
            ("AV_RANGE_KM", 300.0, (240.0, 360.0), "电动充电"),
            ("TAXI_BREAK_MIN", 240.0, (192.0, 288.0), "司机换更")):
            for value in values:
                before = assignment_metrics()
                need = fleet_variant(duty, parameter, value, data, zones)
                after = assignment_metrics()
                rows.append(record(parameter, default, value, before, after,
                                   fleets[rule], need, rule))

        for index, (parameter, value) in enumerate((
            ("TOLL_WEIGHT", 0.16), ("TOLL_WEIGHT", 0.24),
            ("TAXI_TOLL_WEIGHT", 0.16), ("TAXI_TOLL_WEIGHT", 0.24)), start=2):
            label = f"{index:02d}-{parameter.lower()}-{value:.2f}"
            backups[label] = run_assignment(folder, label, parameter, value)
            after = assignment_metrics()
            rows.append(record(parameter, 0.20, value, original, after,
                               fleets["不休息"], fleets["不休息"], "不休息"))
    except BaseException as exc:
        failure = exc
        print(f"扰动中断：{type(exc).__name__}: {exc}；立即执行默认 27 复位", flush=True)
    finally:
        try:
            backups["99-final-default"] = run_assignment(folder, "99-final-default")
        except BaseException as reset_exc:
            for source in (ASSIGNMENT, ASSIGNMENT_AUDIT):
                shutil.copy2(folder / "00-original" / source.name, source)
            raise RuntimeError("final default 27 failed; original files restored from backup") from reset_exc

    restored = assignment_metrics()
    if restored["corridor_geh_under_5"] != original["corridor_geh_under_5"]:
        for source in (ASSIGNMENT, ASSIGNMENT_AUDIT):
            shutil.copy2(folder / "00-original" / source.name, source)
        raise RuntimeError("final default 27 changed corridor GEH; original files restored from backup")
    default_hashes = {source.name: digest(source) == initial[source.name]["sha256"]
                      for source in (ASSIGNMENT, ASSIGNMENT_AUDIT)}
    if not all(default_hashes.values()):
        for source in (ASSIGNMENT, ASSIGNMENT_AUDIT):
            shutil.copy2(folder / "00-original" / source.name, source)
        restored = assignment_metrics()
        print("默认 27 的走廊指标精确复位，但文件字节不同；已从原始备份恢复两份标定产出", flush=True)
    if restored["corridor_geh_under_5"] != original["corridor_geh_under_5"]:
        raise RuntimeError("original backup restore failed corridor GEH check")
    if failure is not None:
        raise RuntimeError("study incomplete; default assignment output was reset") from failure
    if len(rows) != 8 or any(set(row["before"]) != set(row["after"]) for row in rows):
        raise RuntimeError("missing perturbation or one of the three required metrics")
    flags = red_flags(rows)
    audit = {
        "method": "one parameter at a time, ±20%; four serial step-27 perturbations",
        "baseline": {"assignment": original, "fleet_by_rule": fleets},
        "perturbations": rows, "red_flags": flags,
        "untested_parameters": UNTESTED,
        "caveats": ["17 corridor stations: one station is 5.88 percentage points; a one-station movement alone is not sensitivity evidence",
                    "step 35 uses fixed requests and measured speeds independent of step 27",
                    "12,000 vehicles is the no-break floor; the default 240-minute driver-break rule already requires 14,000"],
        "checks": {
            "1_final_corridor_exact_reset": restored["corridor_geh_under_5"] == original["corridor_geh_under_5"],
            "2_backups_nonempty": all(all(item["bytes"] > 0 for item in pair.values()) for pair in backups.values()),
            "3_all_eight_rows_three_metrics": len(rows) == 8 and all(
                all(key in row[side] for key in ("corridor_geh_under_5", "max_class_ratio_deviation", "fleet_min"))
                for row in rows for side in ("before", "after")),
            "4_at_least_five_untested": len(UNTESTED) >= 5,
            "5_red_flags_separate": all(flag["marker"] == "🔴" for flag in flags),
        },
        "restore": {"before": original["corridor_geh_under_5"],
                    "after": restored["corridor_geh_under_5"],
                    "default_run_parquet_sha256_equal": default_hashes[ASSIGNMENT.name],
                    "default_run_audit_sha256_equal": default_hashes[ASSIGNMENT_AUDIT.name],
                    "original_bytes_restored_after_default": not all(default_hashes.values()),
                    "parquet_sha256_equal": digest(ASSIGNMENT) == initial[ASSIGNMENT.name]["sha256"],
                    "audit_sha256_equal": digest(ASSIGNMENT_AUDIT) == initial[ASSIGNMENT_AUDIT.name]["sha256"]},
        "backups": backups,
    }
    if not all(audit["checks"].values()):
        raise RuntimeError(f"acceptance check failed: {audit['checks']}")
    OUTPUT.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print_summary(audit)


if __name__ == "__main__":
    if sys.argv[1:] == ["--print-summary"]:
        print_summary(json.loads(OUTPUT.read_text(encoding="utf-8")))
    elif sys.argv[1:]:
        raise SystemExit("usage: sensitivity.py [--print-summary]")
    else:
        main()
