"""Build docs/data-tiers.md (bilingual) from model/registry/data_tiers.toml.

The registry is the single source of truth for how far every dataset, model output and parameter can be
trusted. Edit the TOML, then run (project root):
    uv run python model/registry/build_doc.py
tests/test_data_tiers.py fails if the document is out of date or a registered value no longer matches
the audit file it points to.
"""
import json
import sys
import tomllib
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "model" / "registry" / "data_tiers.toml"
DOC = ROOT / "docs" / "data-tiers.md"

TIERS = {
    "A": ("实测", "Measured", "🟢", "官方直接公布的数字，可直接引用", "Published official figures; can be quoted directly"),
    "B": ("校准推算", "Calibrated", "🔵", "模型算出、已与官方数字对账，并写明误差", "Computed by the model and checked against official figures, error stated"),
    "C": ("依据推断", "Evidence-based estimate", "🟠", "无本地实测，按有出处的资料推出；仅供参考", "No local measurement; derived from cited sources; for reference only"),
    "D": ("示意假设", "Illustrative assumption", "🔴", "无可靠出处、按常理取值，只为让计算能跑、演示规律；仅供学习，不可用于真实决策",
          "No reliable source; a plausible value so the calculation runs and shows the mechanism; for learning only, never for real decisions"),
}
KINDS = {"dataset": ("数据集", "Dataset"), "model_output": ("模型产物", "Model output"), "parameter": ("参数", "Parameter")}
STATUS = {"in_use": ("在用", "in use"), "to_research": ("待查", "to research"), "excluded": ("不做", "excluded")}


def load() -> list[dict]:
    return tomllib.loads(REGISTRY.read_text(encoding="utf-8"))["item"]


def audit_value(ref: str):
    """'file.json#key' or 'file.json#key.subkey'."""
    path, key = ref.split("#")
    value = json.loads((ROOT / path).read_text(encoding="utf-8"))
    for part in key.split("."):
        value = value[part]
    return value


def fmt(v) -> str:
    if isinstance(v, dict):
        return "；".join(f"{k} {fmt(x)}" for k, x in v.items())
    if isinstance(v, float):
        return f"{v:.4g}"
    return str(v)


def cell(s: str) -> str:
    return str(s).replace("|", "/").replace("\n", " ")


def render(items: list[dict]) -> str:
    out = [
        "# 数据与参数可信度分级 / Data & Parameter Confidence Tiers",
        "",
        "> 本页由 `model/registry/build_doc.py` 根据 `model/registry/data_tiers.toml` 自动生成，**不要手改**；改登记表后重新运行。",
        "> Generated from `model/registry/data_tiers.toml` by `model/registry/build_doc.py` — **do not edit by hand**.",
        "",
        "## 四个级别 / The four tiers",
        "",
        "| 级别 Tier | 名称 | Name | 含义 | Meaning |",
        "|---|---|---|---|---|",
    ]
    for t, (zh, en, icon, mzh, men) in TIERS.items():
        out.append(f"| {icon} **{t}** | {zh} | {en} | {mzh} | {men} |")
    out += [
        "",
        "**结果的级别 = 它用到的最差那个数据的级别**（链子的强度取决于最弱的一环）。例如回本年数用到 C 级造价，就是 C 级结果。",
        "**A result is only as trustworthy as its weakest input**: a payback period that uses a tier-C cost is a tier-C result.",
        "",
        "## 统计 / Summary",
        "",
        "| 类别 Kind | 🟢 A | 🔵 B | 🟠 C | 🔴 D | 合计 Total |",
        "|---|---|---|---|---|---|",
    ]
    count = Counter((i["kind"], i["tier"]) for i in items)
    for k, (zh, en) in KINDS.items():
        row = [count.get((k, t), 0) for t in TIERS]
        out.append(f"| {zh} {en} | " + " | ".join(str(n) for n in row) + f" | {sum(row)} |")
    for t, (zh, en, icon, _, _) in TIERS.items():
        group = [i for i in items if i["tier"] == t]
        out += ["", f"## {icon} {t} · {zh} / {en}（{len(group)}）", "",
                "| ID | 名称 | Name | 类别 Kind | 数值 Value | 来源 / 依据 Source | 状态 Status | 说明 | Note |",
                "|---|---|---|---|---|---|---|---|---|"]
        for i in group:
            kzh, ken = KINDS[i["kind"]]
            szh, sen = STATUS[i["status"]]
            value = fmt(i.get("value", "")) + (f" {i['unit']}" if i.get("unit") and "value" in i else "")
            src = i.get("source", "") + (f"（`{i['code']}`）" if i.get("code") else "")
            out.append("| " + " | ".join(cell(x) for x in [
                i["id"], i["name_zh"], i["name_en"], f"{kzh} {ken}", value, src, f"{szh} {sen}",
                i.get("note_zh", ""), i.get("note_en", "")]) + " |")
    out += ["", "数据集与模型产物的详细描述（条数、字段、用在哪一步）见 [`data-sources.md`](data-sources.md)；"
            "每一步的方程与拟合见 [`methods-catalogue.md`](methods-catalogue.md)。",
            "Details of every dataset are in `data-sources.md`; equations and calibration in `methods-catalogue.en.md`.", ""]
    return "\n".join(out)


def main() -> None:
    items = load()
    DOC.write_text(render(items), encoding="utf-8")
    print(f"-> {DOC.relative_to(ROOT)}（{len(items)} 项 / items）")


if __name__ == "__main__":
    sys.exit(main())
