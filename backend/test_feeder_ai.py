"""The feeder game's AI routes, with DeepSeek replaced by canned replies (no key, no network)."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import feeder_ai

app = FastAPI()
app.include_router(feeder_ai.router)
client = TestClient(app)

GOOD = {"area": "kowloon-east", "period": "am", "mode": 3,
        "changes": [{"place": "啟德", "what": "people", "pct": 50, "by_year": 4}],
        "title": "啟德再多五萬人", "story": ["假設啟德新屋苑陸續入伙。", "畫一條線，別讓觀塘繞道塞死。"], "note": "啟德 +50%"}


def replies(monkeypatch, *texts):
    """Make chat() return these texts one after another, and record the messages it was sent."""
    seen, queue = [], list(texts)

    async def fake(messages, **kw):
        seen.append(messages)
        return queue.pop(0)
    monkeypatch.setattr(feeder_ai, "chat", fake)
    return seen


def test_validate_good_and_tidy():
    req, problems, notes = feeder_ai.validate({**GOOD, "period": "dawn", "mode": 2,
                                               "changes": [{"place": "觀塘繞道", "what": "road_cap", "pct": -90}]})
    assert problems == [] and req["period"] == "am" and req["mode"] == 3
    assert req["changes"] == [{"place": "觀塘繞道", "what": "road_cap", "pct": -60}]
    assert any("-90" in n for n in notes)


@pytest.mark.parametrize("bad,code", [
    ({**GOOD, "area": "mars"}, "area_unknown"),
    ({**GOOD, "changes": [{"place": "x", "what": "people", "pct": 10}] * 5}, "too_many_changes"),
    ({**GOOD, "changes": [{"place": "", "what": "people", "pct": 10}]}, "change_bad"),
    ({**GOOD, "title": ""}, "text_missing"),
    ({"refuse": "不是交通"}, "refuse"),
    ("not json", "bad_json"),
])
def test_validate_problems(bad, code):
    req, problems, _ = feeder_ai.validate(bad)
    assert req is None and problems[0]["code"] == code


def test_validate_absolute_numbers():
    req, problems, notes = feeder_ai.validate({**GOOD, "changes": [{"place": "啟德", "what": "people", "add": 50000},
                                                                  {"place": "觀塘", "what": "jobs", "add": 900000}]})
    assert problems == [] and req["changes"][0] == {"place": "啟德", "what": "people", "add": 50000}
    assert req["changes"][1]["add"] == 300000 and notes


def test_validate_names_from_the_grid():
    names = {"kowloon-east": ["啟德", "觀塘"]}
    assert feeder_ai.validate(GOOD, names)[0]
    req, problems, _ = feeder_ai.validate({**GOOD, "changes": [{"place": "旺角", "what": "people", "pct": 20}]}, names)
    assert req is None and problems[0]["code"] == "place_unknown"


def test_prompt_lists_every_area_and_asks_for_json():
    p = feeder_ai.system_prompt("zh-Hant", {"sha-tin-tai-wai": ["沙田第一城"]})
    assert all(a["key"] in p for a in feeder_ai.AREAS) and "json" in p.lower() and "沙田第一城" in p and "繁體中文" in p


def test_status_without_key(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    r = client.get("/api/feeder/ai/status")
    assert r.status_code == 200 and r.json()["ready"] is False and len(r.json()["areas"]) == 20


def test_level_without_key_is_503(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    r = client.post("/api/feeder/ai/level", json={"sentence": "啟德多五萬人"})
    assert r.status_code == 503 and "message" in r.json()


def test_level_ok_first_try(monkeypatch):
    replies(monkeypatch, json.dumps(GOOD, ensure_ascii=False))
    r = client.post("/api/feeder/ai/level", json={"sentence": "啟德多五萬人", "lang": "zh-Hant"})
    assert r.status_code == 200 and r.json()["request"]["area"] == "kowloon-east" and r.json()["attempts"] == 1


def test_level_fixed_on_second_try(monkeypatch):
    seen = replies(monkeypatch, json.dumps({**GOOD, "area": "mars"}), "```json\n" + json.dumps(GOOD) + "\n```")
    r = client.post("/api/feeder/ai/level", json={"sentence": "啟德多五萬人"})
    assert r.status_code == 200 and r.json()["attempts"] == 2 and "area_unknown" in seen[1][-1]["content"]


def test_level_refuse_and_give_up(monkeypatch):
    replies(monkeypatch, json.dumps({"refuse": "跟交通無關"}))
    r = client.post("/api/feeder/ai/level", json={"sentence": "寫一首詩"})
    assert r.status_code == 422 and r.json()["code"] == "refuse"
    replies(monkeypatch, "{}", "{}")
    assert client.post("/api/feeder/ai/level", json={"sentence": "x"}).status_code == 422


def test_level_feedback_is_passed_on(monkeypatch):
    seen = replies(monkeypatch, json.dumps(GOOD))
    client.post("/api/feeder/ai/level", json={"sentence": "x", "feedback": [{"code": "too_easy"}]})
    assert "too_easy" in seen[0][-1]["content"]


SUMMARY = {"title": "啟德再多五萬人", "score": 2617, "tiers": [1500, 2600, 3600], "doNothing": 977,
           "roads": [{"name": "觀塘繞道", "carsBefore": 82, "carsAfter": 61}]}


def test_comment_numbers_checked(monkeypatch):
    assert feeder_ai.numbers_ok("你拿了 2617 分，觀塘繞道從 82 輛降到 61 輛。", SUMMARY)
    assert not feeder_ai.numbers_ok("省了 4000 分鐘。", SUMMARY)
    replies(monkeypatch, "省了 4000 分鐘。", "你拿了 2617 分，過了高分線 2600。")
    r = client.post("/api/feeder/ai/comment", json={"summary": SUMMARY})
    assert r.status_code == 200 and r.json()["comment"].startswith("你拿了 2617")
    replies(monkeypatch, "4000", "5000")
    assert client.post("/api/feeder/ai/comment", json={"summary": SUMMARY}).status_code == 422
