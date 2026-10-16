"""The feeder game's AI routes, with DeepSeek replaced by canned replies (no key, no network)."""
import json
import copy

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import feeder_ai

app = FastAPI()
app.include_router(feeder_ai.router)
client = TestClient(app)

GOOD = {"area": "kai-tak", "period": "am", "mode": 3,
        "changes": [{"place": "啓德站一帶", "what": "people", "add": 50000}],
        "title": "啟德再多五萬人", "story": ["假設啟德新屋苑陸續入伙。", "畫一條線，別讓觀塘繞道塞死。"], "note": "啟德 +50%"}

NAMES = {"kai-tak": {"places": ["啓德站一帶", "九龍灣站一帶"], "roads": ["觀塘繞道"]}}


@pytest.fixture(autouse=True)
def offline_only(monkeypatch):
    """Every route test replaces chat, including the unavailable-key test. Never read credentials."""
    async def unavailable(*args, **kwargs):
        raise feeder_ai.AIUnavailable("DEEPSEEK_API_KEY is not set (fixed offline reply)")
    monkeypatch.setattr(feeder_ai, "chat", unavailable)
    monkeypatch.setattr(feeder_ai, "_config", lambda: ("", "", "offline-fixture"))
    def forbidden_network(*args, **kwargs):
        raise AssertionError("network forbidden in offline tests")
    monkeypatch.setattr(feeder_ai.httpx, "AsyncClient", forbidden_network)


def replies(monkeypatch, *texts):
    """Make chat() return these texts one after another, and record the messages it was sent."""
    seen, queue = [], list(texts)

    async def fake(messages, **kw):
        seen.append(copy.deepcopy(messages))
        return queue.pop(0)
    monkeypatch.setattr(feeder_ai, "chat", fake)
    return seen


def test_validate_good_and_tidy():
    req, problems, notes = feeder_ai.validate({**GOOD, "period": "dawn", "mode": 99,
                                               "changes": [{"place": "觀塘繞道", "what": "road_cap", "pct": -90}]}, NAMES)
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
    assert problems == [] and req["changes"][0] == {"place": "啓德站一帶", "what": "people", "add": 50000}
    assert req["changes"][1]["add"] == 300000 and notes


def test_validate_names_from_the_grid():
    names = {"kai-tak": ["啓德站一帶", "觀塘"]}
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
    assert r.status_code == 200 and r.json()["request"]["area"] == "kai-tak" and r.json()["attempts"] == 1


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
    client.post("/api/feeder/ai/level", json={"sentence": "啟德多五萬人", "feedback": [{"code": "too_easy"}]})
    assert "too_easy" in seen[0][-1]["content"]
    assert "不得" in seen[0][-1]["content"] and "请换片区" not in seen[0][-1]["content"]


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


@pytest.mark.parametrize("mode", [2, 3, 4])
def test_all_modes_and_forced_mode(monkeypatch, mode):
    replies(monkeypatch, json.dumps({**GOOD, "changes": []}))
    r = client.post("/api/feeder/ai/level", json={"sentence": "修地铁", "mode": mode})
    assert r.status_code == 200 and r.json()["request"]["mode"] == mode
    assert feeder_ai.validate({**GOOD, "mode": mode})[0]["mode"] == mode


@pytest.mark.parametrize("mode", [2, 4])
def test_road_capacity_cannot_leak_to_other_modes(monkeypatch, mode):
    bad = {**GOOD, "mode": mode, "changes": [{"place": "觀塘道", "what": "road_cap", "pct": -30}]}
    assert feeder_ai.validate(bad)[1][0]["code"] == "change_mode_conflict"
    seen = replies(monkeypatch, json.dumps(bad), json.dumps({**GOOD, "mode": 3, "changes": []}))
    r = client.post("/api/feeder/ai/level", json={"sentence": "修地铁", "mode": mode})
    assert r.status_code == 200 and r.json()["attempts"] == 2
    assert r.json()["request"]["mode"] == mode
    assert "change_mode_conflict" in seen[1][-1]["content"]


@pytest.mark.parametrize("mode", [1, 5, "2", True, [], {}])
def test_invalid_player_modes_are_rejected_without_ai(monkeypatch, mode):
    async def forbidden(*args, **kwargs):
        raise AssertionError("must not call AI for invalid mode")
    monkeypatch.setattr(feeder_ai, "chat", forbidden)
    r = client.post("/api/feeder/ai/level", json={"sentence": "修地铁", "mode": mode})
    assert r.status_code == 400


def test_prompt_has_mode_selection_rules():
    p = feeder_ai.system_prompt(mode=4)
    assert "当前面板指定：4" in p
    assert all(word in p for word in ["卖地", "开发", "物业", "新屋苑", "塞车", "隧道", "新线", "road_cap"])


def test_automatic_mode_uses_ai_choice(monkeypatch):
    replies(monkeypatch, json.dumps({**GOOD, "mode": 4, "area": "tung-chung", "changes": []}))
    r = client.post("/api/feeder/ai/level", json={"sentence": "东涌卖地建新屋苑"})
    assert r.status_code == 200 and r.json()["request"]["mode"] == 4


@pytest.mark.parametrize("sentence,what", [
    ("东涌要修一条新地铁线", "people"), ("东涌要修一条新地铁线", "jobs"),
    ("东涌只卖地", "people"), ("东涌只卖地", "jobs"),
    ("观塘道很塞车", "road_cap"), ("启德多五万人", "jobs"),
    ("启德只研究现有交通，不增加人口和岗位", "people"),
    ("启德只研究现有交通，不增加人口和岗位", "jobs"),
    ("启德多五万人，不要增加岗位", "jobs"),
    ("东涌居民想多修一条地铁", "people"),
    ("东涌想多修地铁方便居民找工作", "jobs"),
])
def test_sentence_does_not_authorise_extra_changes(sentence, what):
    obj = {**GOOD, "changes": [{"place": "啓德站一帶", "what": what, "pct": 30}]}
    req, problems, notes = feeder_ai.validate(obj, NAMES, sentence=sentence)
    assert req is None and any(p["code"] == "unsupported_change" for p in problems)
    assert any("原句未明说" in n for n in notes)


def test_no_changes_survives_and_hallucination_retries(monkeypatch):
    good = {**GOOD, "area": "tung-chung", "mode": 2, "changes": [], "title": "东涌地铁新线"}
    bad = {**good, "changes": [{"place": "逸東邨", "what": "people", "pct": 30},
                               {"place": "東涌站一帶", "what": "jobs", "pct": 30}]}
    seen = replies(monkeypatch, json.dumps(bad), json.dumps(good))
    r = client.post("/api/feeder/ai/level", json={"sentence": "东涌要修一条新地铁线"})
    assert r.status_code == 200 and r.json()["attempts"] == 2
    assert r.json()["request"]["changes"] == [] and "unsupported_change" in seen[1][-1]["content"]
    assert any("原句未明说" in note for note in r.json()["notes"])


@pytest.mark.parametrize("place", ["启德", "啟德", "啓德", "Kai Tak"])
def test_kai_tak_alias_is_stable(place):
    req, problems, _ = feeder_ai.validate({**GOOD, "changes": [{"place": place, "what": "people", "add": 50000}]},
                                        NAMES, sentence=f"{place}多五万人")
    assert not problems and req["area"] == "kai-tak" and req["changes"][0]["place"] == "啓德站一帶"


def test_neighbour_zone_and_area_cannot_replace_kai_tak(monkeypatch):
    wrong = {**GOOD, "changes": [{"place": "九龍灣站一帶", "what": "people", "add": 50000}]}
    assert any(p["code"] == "alias_place_mismatch" for p in feeder_ai.validate(wrong, NAMES, sentence="启德多五万人")[1])
    assert any(p["code"] == "alias_area_mismatch" for p in feeder_ai.validate({**GOOD,"area":"kowloon-east"}, sentence="启德多五万人")[1])
    replies(monkeypatch, json.dumps(wrong), json.dumps(GOOD))
    r=client.post("/api/feeder/ai/level",json={"sentence":"启德多五万人","names":NAMES})
    assert r.status_code==200 and r.json()["request"]["changes"][0]["add"]==50000


def test_first_city_and_northern_metropolis(monkeypatch):
    names={"sha-tin-tai-wai":{"places":["第一城站一帶"],"roads":[]}}
    obj={**GOOD,"area":"sha-tin-tai-wai","changes":[{"place":"第一城","what":"people","add":5000}]}
    req, problems, _=feeder_ai.validate(obj,names,sentence="第一城多五千人")
    assert not problems and req["changes"][0]["place"]=="第一城站一帶"
    replies(monkeypatch,json.dumps({**GOOD,"area":"northern-metropolis","changes":[]}))
    r=client.post("/api/feeder/ai/level",json={"sentence":"北都未来交通"})
    assert r.status_code==422 and r.json()["code"]=="area_empty"
    assert any("古洞" in n and "新田" in n for n in r.json()["notes"])


def test_typed_menu_rejects_zones_as_roads_and_preserves_legacy_places():
    obj={**GOOD,"changes":[{"place":"啓德站一帶","what":"road_cap","pct":-40}]}
    assert feeder_ai.validate(obj,NAMES)[1][0]["code"]=="place_unknown"
    assert feeder_ai.validate(obj,{"kai-tak":["啓德站一帶"]})[1][0]["code"]=="road_menu_missing"
    assert feeder_ai.validate(GOOD,{"kai-tak":["啓德站一帶"]})[0]
    assert feeder_ai.validate(GOOD,{"kai-tak":{"places":[],"roads":[]}})[0] is None


def test_prompt_does_not_truncate_places_and_separates_roads():
    places=[f"分区{i}" for i in range(55)]+["啓德站一帶"]
    p=feeder_ai.system_prompt(names={"kai-tak":{"places":places,"roads":["觀塘繞道"]}})
    assert "分区54" in p and "啓德站一帶" in p and "道路名（只供 road_cap）" in p
    assert all(s in p for s in ["没说就留空", "changes=[]", "將隧封線早高峰", "4–10", "北都"])


@pytest.mark.parametrize("title,ok",[("新地铁",False),("启德新线",True),("一二三四五六七八九十",True),("一二三四五六七八九十一",False),("TKO新線",False)])
def test_chinese_title_length(title,ok):
    req,problems,_=feeder_ai.validate({**GOOD,"title":title})
    assert bool(req)==ok
    if not ok:assert any(p["code"]=="title_length" for p in problems)


def test_english_title_and_unstated_year():
    req,problems,notes=feeder_ai.validate({**GOOD,"title":"A new line for Kai Tak","changes":[{**GOOD['changes'][0],"by_year":4}]},
                                       sentence="启德多五万人",lang="en")
    assert not problems and "by_year" not in req["changes"][0] and notes


@pytest.mark.parametrize("value",[float('nan'),float('inf'),True])
def test_invalid_non_finite_changes(value):
    assert feeder_ai.validate({**GOOD,"changes":[{"place":"啓德站一帶","what":"people","pct":value}]})[0] is None


def test_duplicate_and_dual_amount_changes_rejected():
    assert feeder_ai.validate({**GOOD,"changes":GOOD['changes']*2})[1][0]['code']=='duplicate_change'
    assert feeder_ai.validate({**GOOD,"changes":[{**GOOD['changes'][0],'pct':30}]})[1][0]['code']=='change_bad'
