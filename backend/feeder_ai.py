"""AI for the feeder game's fifth mode (the Hong Kong sandbox): one sentence → a level request, and a short commentary.

The AI gets very little freedom (docs/for-codex/2026-10-13-五模式与AI生成关卡.md §7): it picks an area from a menu, a
time of day, and at most four changes (people / jobs / road capacity of a named place, within ranges). Everything else —
cutting the area out of the Hong Kong grid, building the level, the bot that sets the tiers — is code
(game-feeder/v7/shared/levelgen/, task 53). The commentary may only use numbers the game gives it; the code checks that.

Routes (errors as {"message": ...}, like the team site's /api/game/ai/*):
  GET  /api/feeder/ai/status    {ready, model}
  POST /api/feeder/ai/level     {sentence, lang?, names?, feedback?}  → {request, notes, attempts, ms}
  POST /api/feeder/ai/comment   {summary, lang?}                      → {comment, checked, ms}
The key stays on the server: DEEPSEEK_API_KEY (and DEEPSEEK_BASE_URL, DEEPSEEK_MODEL) from the environment / .env.
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/feeder/ai", tags=["feeder-ai"])

# The areas a level can be cut from — the same list as task 51 §5 (hk-base.json `areas`), centre station in brackets.
AREAS: list[dict[str, str]] = [
    {"key": "kowloon-east", "name": "九龍東", "hans": "九龙东", "en": "Kowloon East", "center": "觀塘"},
    {"key": "kai-tak", "name": "啟德", "hans": "启德", "en": "Kai Tak", "center": "啟德"},
    {"key": "mong-kok", "name": "旺角·油尖旺", "hans": "旺角·油尖旺", "en": "Mong Kok", "center": "旺角"},
    {"key": "tsim-sha-tsui", "name": "尖沙咀", "hans": "尖沙咀", "en": "Tsim Sha Tsui", "center": "尖沙咀"},
    {"key": "central", "name": "中環·金鐘", "hans": "中环·金钟", "en": "Central & Admiralty", "center": "金鐘"},
    {"key": "causeway-bay", "name": "銅鑼灣·灣仔", "hans": "铜锣湾·湾仔", "en": "Causeway Bay & Wan Chai", "center": "銅鑼灣"},
    {"key": "sham-shui-po", "name": "深水埗·長沙灣", "hans": "深水埗·长沙湾", "en": "Sham Shui Po", "center": "長沙灣"},
    {"key": "hung-hom", "name": "紅磡·何文田", "hans": "红磡·何文田", "en": "Hung Hom & Ho Man Tin", "center": "紅磡"},
    {"key": "tsuen-wan", "name": "荃灣·葵青", "hans": "荃湾·葵青", "en": "Tsuen Wan & Kwai Tsing", "center": "荃灣"},
    {"key": "sha-tin", "name": "沙田·大圍", "hans": "沙田·大围", "en": "Sha Tin & Tai Wai", "center": "沙田"},
    {"key": "ma-on-shan", "name": "馬鞍山", "hans": "马鞍山", "en": "Ma On Shan", "center": "馬鞍山"},
    {"key": "tai-po", "name": "大埔", "hans": "大埔", "en": "Tai Po", "center": "大埔墟"},
    {"key": "fanling", "name": "粉嶺·上水", "hans": "粉岭·上水", "en": "Fanling & Sheung Shui", "center": "粉嶺"},
    {"key": "yuen-long", "name": "元朗", "hans": "元朗", "en": "Yuen Long", "center": "元朗"},
    {"key": "tin-shui-wai", "name": "天水圍·洪水橋", "hans": "天水围·洪水桥", "en": "Tin Shui Wai & Hung Shui Kiu", "center": "天水圍"},
    {"key": "tuen-mun", "name": "屯門", "hans": "屯门", "en": "Tuen Mun", "center": "屯門"},
    {"key": "tseung-kwan-o", "name": "將軍澳", "hans": "将军澳", "en": "Tseung Kwan O", "center": "將軍澳"},
    {"key": "tung-chung", "name": "東涌", "hans": "东涌", "en": "Tung Chung", "center": "東涌"},
    {"key": "southern", "name": "港島南", "hans": "港岛南", "en": "Southern District", "center": "黃竹坑"},
    {"key": "northern-metropolis", "name": "北部都會區·新田古洞", "hans": "北部都会区·新田古洞", "en": "Northern Metropolis", "center": "落馬洲"},
]
AREA_KEYS = {a["key"] for a in AREAS}
PERIODS = {"am": "平日早高峰 08–09", "pm": "平日晚高峰 18–19", "day": "平日日常（白天平峰）", "holiday": "節假日大流量"}
MODES = {3}                                   # mode 3 (metro + roads) first; 2 and 4 once the cutter supports them
WHAT = {"people": (-50, 150), "jobs": (-50, 150), "road_cap": (-60, 50)}   # allowed % change
MAX_CHANGES, MAX_YEAR = 4, 8
LANGS = {"zh-Hant", "zh-Hans", "en"}


def system_prompt(lang: str = "zh-Hans", names: dict[str, list[str]] | None = None) -> str:
    """The instructions for one sentence → one level request. `names`: place names inside each area, when the game has
    the Hong Kong grid loaded (then the AI must pick from them)."""
    areas = "\n".join(
        f"- {a['key']}：{a['name']}（{a['en']}，中心站 {a['center']}）"
        + (f"；可选地名：{'、'.join(names[a['key']][:40])}" if names and names.get(a["key"]) else "")
        for a in AREAS)
    out_lang = {"zh-Hant": "繁體中文", "zh-Hans": "简体中文", "en": "English"}.get(lang, "简体中文")
    return f"""你是 TransitLab 香港交通游戏的「关卡助手」。玩家说一句话，你把它变成一个关卡请求。只输出一个 JSON 对象，不要别的文字。

## 你只能从菜单里选
片区 area（只能选下面的 key，不能编新片区；玩家说的地方不在里面，就选最近的一片，并在 note 里说明）：
{areas}

时段 period：am（{PERIODS['am']}）、pm（{PERIODS['pm']}）、day（{PERIODS['day']}）、holiday（{PERIODS['holiday']}）。
  说上班 / 早上 → am；下班 / 晚上 → pm；周末 / 节日 / 假期 / 演唱会 / 烟花 → holiday；白天购物 / 办事 → day；没说就用 am。
规则 mode：现在只有 3（地铁 + 路会塞）。

改动 changes：0 到 {MAX_CHANGES} 条，每条 {{"place": 地名, "what": "people"|"jobs"|"road_cap", "pct": 整数, "by_year": 整数(可省)}}
- place：这一片里的真实地名（屋苑、商业区、路名），用繁體中文；有「可选地名」时只能从里面选。不要写坐标。
- what：people＝住的人；jobs＝岗位 / 去那里的吸引力；road_cap＝这条路能过的车（封一条线、修路、扩路）。
- pct 范围：people、jobs −50 到 +150；road_cap −60 到 +50。
  规模参考：小 +10～20、中 +30～50、大 +60～100、全城级 +100～150；封一条线 −30～−50；扩路 +20～+50。
- by_year：「几年后」「陆续入伙」「慢慢」这类说法才写，1～{MAX_YEAR}；马上发生就不写。

文字（用{out_lang}）：
- title：关卡名，12 个字以内。
- story：两句话，每句 40 个字以内，第一句说发生了什么，第二句说玩家要做什么；你选的规模是假设，要写「假设……」。除了你选的 pct，不要编别的数字。
- note：一句话，说你把哪些地方 / 规模理解成了什么（给玩家核对）。

## 不做的
跟交通、城市、人流无关的话，或者伤害他人的内容：只输出 {{"refuse": "一句原因"}}。

## 输出格式（json）
{{"area": "kowloon-east", "period": "am", "mode": 3, "changes": [{{"place": "啟德", "what": "people", "pct": 50, "by_year": 4}}], "title": "…", "story": ["…", "…"], "note": "…"}}"""


def validate(obj: Any, names: dict[str, list[str]] | None = None) -> tuple[dict | None, list[dict], list[str]]:
    """Check and tidy a level request. Returns (request or None, problems that need the AI again, notes on what was
    tidied). A problem has a code: bad_json, refuse, area_unknown, too_many_changes, change_bad, place_unknown,
    text_missing."""
    problems: list[dict] = []
    notes: list[str] = []
    if not isinstance(obj, dict):
        return None, [{"code": "bad_json", "message": "not a JSON object"}], notes
    if obj.get("refuse"):
        return None, [{"code": "refuse", "message": str(obj["refuse"])[:120]}], notes
    area = obj.get("area")
    if area not in AREA_KEYS:
        problems.append({"code": "area_unknown", "message": f"area {area!r} is not one of the keys"})
    period = obj.get("period", "am")
    if period not in PERIODS:
        notes.append(f"period {period!r} → am")
        period = "am"
    mode = obj.get("mode", 3)
    if mode not in MODES:
        notes.append(f"mode {mode!r} → 3")
        mode = 3
    raw = obj.get("changes") or []
    if not isinstance(raw, list):
        raw = []
        problems.append({"code": "change_bad", "message": "changes must be a list"})
    if len(raw) > MAX_CHANGES:
        problems.append({"code": "too_many_changes", "message": f"at most {MAX_CHANGES} changes"})
    allowed = set(names.get(area, [])) if names and area in AREA_KEYS and names.get(area) else None
    changes = []
    for c in raw[:MAX_CHANGES]:
        if not isinstance(c, dict) or c.get("what") not in WHAT or not str(c.get("place", "")).strip():
            problems.append({"code": "change_bad", "message": f"bad change {c!r}"})
            continue
        place = str(c["place"]).strip()[:20]
        if allowed is not None and place not in allowed:
            problems.append({"code": "place_unknown", "message": f"{place} is not a place in {area}"})
            continue
        lo, hi = WHAT[c["what"]]
        try:
            pct = int(round(float(c.get("pct", 0))))
        except (TypeError, ValueError):
            problems.append({"code": "change_bad", "message": f"pct of {place} is not a number"})
            continue
        if not lo <= pct <= hi:
            notes.append(f"{place} {c['what']} {pct}% → {max(lo, min(hi, pct))}%")
            pct = max(lo, min(hi, pct))
        if pct == 0:
            continue
        ch = {"place": place, "what": c["what"], "pct": pct}
        if c.get("by_year") not in (None, "", 0):
            try:
                ch["by_year"] = max(1, min(MAX_YEAR, int(c["by_year"])))
            except (TypeError, ValueError):
                notes.append(f"{place} by_year dropped")
        changes.append(ch)
    title = str(obj.get("title") or "").strip()
    story = obj.get("story") or []
    if isinstance(story, str):
        story = [story]
    story = [str(s).strip()[:80] for s in story if str(s).strip()][:2]
    if not title or not story:
        problems.append({"code": "text_missing", "message": "title and story are needed"})
    if problems:
        return None, problems, notes
    return ({"area": area, "period": period, "mode": mode, "changes": changes, "title": title[:24], "story": story,
             "note": str(obj.get("note") or "").strip()[:120]}, [], notes)


# ------------------------------------------------------------------------------------------------ DeepSeek
def _config() -> tuple[str, str, str]:
    return (os.getenv("DEEPSEEK_API_KEY", "").strip(),
            os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/") or "https://api.deepseek.com",
            os.getenv("DEEPSEEK_MODEL", "deepseek-chat").strip() or "deepseek-chat")


class AIUnavailable(Exception):
    """No key, or DeepSeek could not be reached."""


async def chat(messages: list[dict], *, json_out: bool, max_tokens: int = 700, temperature: float = 0.3) -> str:
    """One DeepSeek chat completion (OpenAI-compatible). Raises AIUnavailable; never logs the key."""
    key, base, model = _config()
    if not key:
        raise AIUnavailable("DEEPSEEK_API_KEY is not set on the server")
    body: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature,
                            "stream": False}
    if json_out:
        body["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            r = await client.post(f"{base}/chat/completions", json=body, headers={"Authorization": f"Bearer {key}"})
    except httpx.HTTPError as exc:
        raise AIUnavailable(f"DeepSeek unreachable: {type(exc).__name__}") from exc
    if r.status_code != 200:
        raise AIUnavailable(f"DeepSeek returned {r.status_code}")
    return r.json()["choices"][0]["message"]["content"] or ""


def _parse(text: str) -> Any:
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0) if m else text)
    except (json.JSONDecodeError, AttributeError):
        return None


def _fail(status: int, message: str, **extra) -> JSONResponse:
    return JSONResponse({"message": message, **extra}, status_code=status)


@router.get("/status")
async def status() -> dict:
    key, _, model = _config()
    return {"ready": bool(key), "model": model, "areas": [a["key"] for a in AREAS]}


@router.post("/level")
async def level(payload: dict = Body(...)):
    """One sentence → a level request. `feedback`: problems the level builder found with the last request (e.g.
    {"code": "too_easy"}), passed back so the AI can change its choice. Two tries at most."""
    sentence = str(payload.get("sentence") or "").strip()[:200]
    if not sentence:
        return _fail(400, "sentence is empty")
    lang = payload.get("lang") if payload.get("lang") in LANGS else "zh-Hans"
    names = payload.get("names") if isinstance(payload.get("names"), dict) else None
    messages = [{"role": "system", "content": system_prompt(lang, names)}, {"role": "user", "content": sentence}]
    if payload.get("feedback"):
        messages.append({"role": "user", "content": "上一次的关卡不行，原因：" + json.dumps(payload["feedback"], ensure_ascii=False)[:600]
                         + "。请换片区、地点或规模再给一次（仍然只输出 JSON）。"})
    t0, problems = time.perf_counter(), []
    for attempt in (1, 2):
        try:
            text = await chat(messages, json_out=True)
        except AIUnavailable as exc:
            return _fail(503, str(exc))
        obj = _parse(text)
        req, problems, notes = validate(obj, names)
        if req:
            return {"request": req, "notes": notes, "attempts": attempt, "ms": round((time.perf_counter() - t0) * 1000)}
        if problems and problems[0]["code"] == "refuse":
            return _fail(422, problems[0]["message"], code="refuse")
        messages += [{"role": "assistant", "content": text[:1500]},
                     {"role": "user", "content": "这个 JSON 有问题：" + json.dumps(problems, ensure_ascii=False)[:600] + "。请改正后重新输出。"}]
    return _fail(422, "the AI could not produce a valid level request", problems=problems)


# ------------------------------------------------------------------------------------------------ commentary
_NUM = re.compile(r"\d+(?:\.\d+)?")


def _numbers(obj: Any) -> set[float]:
    found: set[float] = set()
    if isinstance(obj, bool):
        return found
    if isinstance(obj, (int, float)):
        found.add(round(float(obj), 1))
    elif isinstance(obj, str):
        found |= {round(float(x), 1) for x in _NUM.findall(obj.replace(",", ""))}
    elif isinstance(obj, dict):
        for v in obj.values():
            found |= _numbers(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            found |= _numbers(v)
    return found


def numbers_ok(text: str, summary: Any) -> bool:
    """Every number in the commentary must be one the game gave (or a rounding of one, or a small count ≤ 10)."""
    allowed = _numbers(summary)
    rounded = allowed | {float(round(x)) for x in allowed}
    for x in _NUM.findall(text.replace(",", "")):
        v = round(float(x), 1)
        if v <= 10 or v in rounded:
            continue
        if any(abs(v - a) <= max(1.0, abs(a) * 0.01) for a in allowed):
            continue
        return False
    return True


@router.post("/comment")
async def comment(payload: dict = Body(...)):
    """A two-or-three-sentence commentary on a finished level. `summary`: the numbers the game shows (score, tiers,
    do-nothing, best, per-year rows, the roads that changed most). Numbers not in the summary are not allowed."""
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        return _fail(400, "summary must be an object")
    lang = payload.get("lang") if payload.get("lang") in LANGS else "zh-Hans"
    out_lang = {"zh-Hant": "繁體中文", "zh-Hans": "简体中文", "en": "English"}[lang]
    system = (f"你是交通规划老师，用{out_lang}给玩家写两到三句复盘点评：先说做得好的一点，再说一个可以更好的地方（具体到地方或做法）。"
              "只能用下面 JSON 里出现的数字，不能编数字、不能编地名。不要客套话。")
    messages = [{"role": "system", "content": system},
                {"role": "user", "content": json.dumps(summary, ensure_ascii=False)[:4000]}]
    t0 = time.perf_counter()
    for _ in (1, 2):
        try:
            text = (await chat(messages, json_out=False, max_tokens=300, temperature=0.5)).strip()
        except AIUnavailable as exc:
            return _fail(503, str(exc))
        if text and numbers_ok(text, summary):
            return {"comment": text[:400], "checked": True, "ms": round((time.perf_counter() - t0) * 1000)}
        messages += [{"role": "assistant", "content": text[:600]},
                     {"role": "user", "content": "里面有不在数据里的数字。只用数据里的数字重写。"}]
    return _fail(422, "the commentary used numbers that are not in the data")
