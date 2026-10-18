"""Read-only verification of the final archive and its expanded submission files."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("Manifest path leaves the submission directory")
    return path


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    manifest = json.loads((repo / "submission/manifest.json").read_text(encoding="utf-8"))
    problems = []
    archive = inside(repo, manifest["source_archive"])
    if not archive.is_file() or sha256(archive) != manifest["archive_sha256"]:
        problems.append("Original archive is missing or its SHA-256 differs")
    folder = inside(repo, manifest["extracted_directory"])
    files = manifest["files"]
    if len(files) != manifest["file_count"] or len({item["path"] for item in files}) != len(files):
        problems.append("Manifest file count or path uniqueness is invalid")
    total = 0
    for item in files:
        path = inside(folder, item["path"])
        if not path.is_file():
            problems.append(f"Missing: {item['path']}")
            continue
        total += path.stat().st_size
        if path.stat().st_size != item["bytes"] or sha256(path) != item["sha256"]:
            problems.append(f"Content differs: {item['path']}")
    if total != manifest["total_bytes"]:
        problems.append("Expanded package total size differs")
    if problems:
        print("FAIL: package verification")
        for problem in problems:
            print(" -", problem)
        return 1
    print(f"PASS: archive SHA-256 and {len(files)} expanded files ({total:,} bytes)")
    print("Read-only delivery check; not a model-accuracy or runtime-feature test.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
