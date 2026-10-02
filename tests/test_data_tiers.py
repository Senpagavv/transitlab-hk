"""The confidence registry (model/registry/data_tiers.toml) must stay complete, consistent and current."""
import importlib.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_doc", ROOT / "model" / "registry" / "build_doc.py")
build_doc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_doc)
ITEMS = build_doc.load()


def test_every_item_is_well_formed():
    ids = [i["id"] for i in ITEMS]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for i in ITEMS:
        for field in ("id", "kind", "name_zh", "name_en", "tier", "status"):
            assert i.get(field), f"{i.get('id')}: missing {field}"
        assert i["tier"] in build_doc.TIERS, i["id"]
        assert i["kind"] in build_doc.KINDS, i["id"]
        assert i["status"] in build_doc.STATUS, i["id"]
        if i["tier"] in ("C", "D") and i["status"] == "in_use":
            assert i.get("note_zh") or i.get("source"), f"{i['id']}: a tier C/D value in use must say where it comes from"


def test_every_data_source_is_registered():
    text = (ROOT / "docs" / "data-sources.md").read_text(encoding="utf-8")
    listed = {line.split("|")[1].strip() for line in text.splitlines()
              if line.startswith("| ") and len(line.split("|")) > 2 and line.split("|")[1].strip()[:1] in "ABCDEFGHIJK"
              and line.split("|")[1].strip()[1:3].isdigit()}
    assert listed <= {i["id"] for i in ITEMS}, f"not in the registry: {sorted(listed - {i['id'] for i in ITEMS})}"


def _same(a, b):
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=1e-3, abs_tol=1e-6)
    return a == b


def test_registered_values_match_their_audit_files():
    for i in ITEMS:
        if "audit" in i and i.get("status") == "in_use":
            assert _same(i["value"], build_doc.audit_value(i["audit"])), \
                f"{i['id']}: registry {i['value']} != {i['audit']} — rerun the step or update the registry"


def test_document_is_up_to_date():
    assert (ROOT / "docs" / "data-tiers.md").read_text(encoding="utf-8") == build_doc.render(ITEMS), \
        "docs/data-tiers.md is stale: run uv run python model/registry/build_doc.py"
