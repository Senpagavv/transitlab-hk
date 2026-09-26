"""Do the documents still say what the model says? Read-only.

Run from the project root (a second):
    uv run python pipeline/check_docs.py

Why. The numbers in README.md, docs/architecture-walkthrough.md and docs/demo-runbook.md are typed
by hand, and the model behind them is rerun almost daily. Twice in one day the documents were found
quoting figures two runs old - a request count, a waiting time, an audit tally - and both times the
stale number was in the part meant for other people to read. Nobody notices, because a wrong number
looks exactly like a right one.

Two rules, and both are needed:

  present   the figure the audits say today must appear somewhere in the document that claims it.
            Catches "the model moved and the document did not".
  retired   a figure that USED to be true must not appear any more. Catches the same thing from the
            other side, and is what makes this cheap: when a number changes, add the old one here
            and the check remembers it forever.

Adding to RETIRED is part of changing a headline number. If that feels like a chore, it is a much
smaller one than presenting a stale figure to a room.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "data" / "web"
DOCS = ["README.md", "docs/architecture-walkthrough.md", "docs/demo-runbook.md"]

# Figures that were true once and are not any more, with the date they were retired. A document may
# not contain these. Keep the reason: it is the only way to tell a retired figure from a typo later.
RETIRED = [
    ("717,198", "2026-09-26", "的士请求数：出行分布加区内系数、塞车回代后变成 715,443"),
    ("703,506", "2026-09-24", "的士请求数，锚定运输署最近 12 个月后变成 717,198"),
    ("70.3 万", "2026-09-24", "同上"),
    ("6.0 分", "2026-09-26", "10,000 辆车队的平均等待，出行分布加区内系数、塞车回代后回到 5.8 分"),
    ("1%–32%", "2026-09-24", "调度省下的车公里区间，现为 0%–31%"),
    ("759.57", "2026-09-24", "人口改锚到统计处 2026 年中估计 7,517,309"),
    ("759.58", "2026-09-24", "同上"),
    ("64 项检查", "2026-09-23", "总审计项数已增长"),
]


def audits() -> dict:
    """The figures the documents are allowed to quote, straight from today's audit files."""
    def load(name: str) -> dict:
        path = WEB / name
        if not path.exists():
            raise RuntimeError(f"缺 data/web/{name} - 先把管线跑一遍")
        return json.loads(path.read_text(encoding="utf-8"))

    simulation, assignment = load("fleet-simulation-audit.json"), load("assignment-audit.json")
    requests = load("taxi-requests-audit.json")
    sweep = {point["fleet"]: point for point in simulation["sweep"]}
    passing = [f for f in sorted(sweep)
               if sweep[f]["served_share"] >= 0.95 and sweep[f]["mean_wait_min"] <= 5]
    total = int(requests["checks"]["1_daily_total"]["requests"])
    return {
        # Each figure is only required where that document actually makes the claim - the README is a
        # front page, not a data sheet, and demanding every number of it would train people to ignore
        # this check.
        "请求总数": (f"{total:,}", ["docs/architecture-walkthrough.md", "docs/demo-runbook.md"]),
        "最小达标车队": (f"{min(passing):,}", DOCS),
        "领牌车队": (f"{simulation['fleet']:,}", DOCS),
        # Must sit on a line that says 走廊 GEH<5: the history table there also holds old values, and on
        # 2026-09-26 an old 29.4% in it let a stale 23.5% pass.
        "走廊 GEH<5": (f"{assignment['corridor_geh_under_5']:.1%}", ["docs/architecture-walkthrough.md"], "走廊 GEH<5"),
    }


def main() -> None:
    problems, checked = [], 0
    texts = {name: (ROOT / name).read_text(encoding="utf-8") for name in DOCS if (ROOT / name).exists()}
    missing = [name for name in DOCS if name not in texts]
    for name in missing:
        problems.append(f"文档不存在：{name}")

    for label, (value, where, *context) in audits().items():
        if not value or not where:
            continue
        for name in where:
            if name not in texts:
                continue
            checked += 1
            lines = [l for l in texts[name].splitlines()
                     if not context or (context[0] in l and not l.lstrip().startswith("|"))]  # history tables don't count
            if not any(value in l for l in lines):
                problems.append(f"{name} 里找不到当前的「{label} = {value}」")

    for value, retired_on, why in RETIRED:
        for name, text in texts.items():
            checked += 1
            # A retired figure must be matched whole: "15.8 分" contains "5.8 分", and the first
            # version of this check reported the good line as the bad one.
            pattern = re.compile(r"(?<![\d.])" + re.escape(value))
            for line_no, line in enumerate(text.splitlines(), 1):
                if pattern.search(line):
                    problems.append(f"{name}:{line_no} 仍写着已作废的「{value}」（{retired_on} 起，{why}）")

    print(f"文档数字体检：{len(texts)} 份文档、{checked} 项检查")
    for line in problems:
        print("   ← " + line)
    if problems:
        print(f"{len(problems)} 项未通过。改数字时，把旧值加进 pipeline/check_docs.py 的 RETIRED。")
        sys.exit(1)
    print("   全部通过：文档引用的数字与当前审计一致，且没有已作废的旧值")


if __name__ == "__main__":
    main()
