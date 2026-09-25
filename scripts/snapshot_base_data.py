"""给做好的模型数据拍一份只读快照，并记下每个文件的指纹（SHA-256）。

用法（项目根目录）：
    .venv\\Scripts\\python.exe scripts/snapshot_base_data.py            拍快照
    .venv\\Scripts\\python.exe scripts/snapshot_base_data.py --check    检查现在的 data/ 和最新快照是否一致

拍的是 data/model（模型产出）和 data/web（网站数据与各步审计）。data/raw 是原始下载、从不改写，
data/cache、data/build 是可再生的缓存，不拍。

快照放在 data/snapshots/<日期时间>/，文件全部设为只读；manifest.json 记录每个文件的大小和指纹。
以后管线重跑、Codex 改动、游戏试验，都不会碰到这里。要恢复：把快照里的文件复制回 data/ 对应位置。
"""
import hashlib
import json
import os
import shutil
import stat
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SNAPSHOTS = DATA / "snapshots"
FOLDERS = ("model", "web")


def fingerprint(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def files() -> list[Path]:
    return sorted(p for folder in FOLDERS for p in (DATA / folder).rglob("*") if p.is_file())


def snapshot() -> None:
    target = SNAPSHOTS / datetime.now().strftime("%Y-%m-%d_%H%M")
    if target.exists():
        sys.exit(f"{target} 已存在，不覆盖")
    manifest = {"created": datetime.now().isoformat(timespec="seconds"), "files": {}}
    for src in files():
        rel = src.relative_to(DATA)
        dst = target / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        digest = fingerprint(dst)
        assert digest == fingerprint(src), f"复制后指纹不一致：{rel}"
        manifest["files"][rel.as_posix()] = {"bytes": dst.stat().st_size, "sha256": digest}
        os.chmod(dst, stat.S_IREAD)
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    os.chmod(target / "manifest.json", stat.S_IREAD)
    total = sum(v["bytes"] for v in manifest["files"].values())
    print(f"快照：{target}（{len(manifest['files'])} 个文件，{total / 1e6:.0f} MB，全部只读）")


def check() -> None:
    latest = sorted(p for p in SNAPSHOTS.iterdir() if (p / "manifest.json").exists())
    if not latest:
        sys.exit("还没有快照")
    manifest = json.loads((latest[-1] / "manifest.json").read_text(encoding="utf-8"))["files"]
    changed, missing = [], []
    for rel, info in manifest.items():
        now = DATA / rel
        if not now.exists():
            missing.append(rel)
        elif fingerprint(now) != info["sha256"]:
            changed.append(rel)
    added = sorted({p.relative_to(DATA).as_posix() for p in files()} - set(manifest))
    print(f"对照快照 {latest[-1].name}：{len(manifest)} 个文件")
    print(f"  改动 {len(changed)} 个" + "".join(f"\n    {r}" for r in changed))
    print(f"  缺失 {len(missing)} 个" + "".join(f"\n    {r}" for r in missing))
    print(f"  新增 {len(added)} 个" + "".join(f"\n    {r}" for r in added))


if __name__ == "__main__":
    check() if "--check" in sys.argv else snapshot()
