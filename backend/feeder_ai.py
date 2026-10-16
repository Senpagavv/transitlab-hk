"""AI for the feeder game's fifth mode (the Hong Kong sandbox): one sentence → a level request, and a short commentary.

The AI gets very little freedom (docs/for-codex/2026-10-13-五模式与AI生成关卡.md §7): it picks an area from a menu, a
time of day, and at most four changes (people / jobs / road capacity of a named place, within ranges). Everything else —
cutting the area out of the Hong Kong grid, building the level, the bot that sets the tiers — is code
(game-feeder/v7/shared/levelgen/, task 53). The commentary may only use numbers the game gives it; the code checks that.

Routes (errors as {"message": ...}, like the team site's /api/game/ai/*):
  GET  /api/feeder/ai/status    {ready, model}
  POST /api/feeder/ai/level     {sentence, lang?, mode?, names?, feedback?}  → {request, notes, attempts, ms}
  POST /api/feeder/ai/comment   {summary, lang?}                      → {comment, checked, ms}
The key stays on the server: DEEPSEEK_API_KEY (and DEEPSEEK_BASE_URL, DEEPSEEK_MODEL) from the environment / .env.
"""
from __future__ import annotations

import json
import math
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
    {"key": "mong-kok-yau-tsim-mong", "name": "旺角·油尖旺", "hans": "旺角·油尖旺", "en": "Mong Kok", "center": "旺角"},
    {"key": "tsim-sha-tsui", "name": "尖沙咀", "hans": "尖沙咀", "en": "Tsim Sha Tsui", "center": "尖沙咀"},
    {"key": "central-admiralty", "name": "中環·金鐘", "hans": "中环·金钟", "en": "Central & Admiralty", "center": "金鐘"},
    {"key": "causeway-bay-wan-chai", "name": "銅鑼灣·灣仔", "hans": "铜锣湾·湾仔", "en": "Causeway Bay & Wan Chai", "center": "銅鑼灣"},
    {"key": "sham-shui-po-cheung-sha-wan", "name": "深水埗·長沙灣", "hans": "深水埗·长沙湾", "en": "Sham Shui Po", "center": "長沙灣"},
    {"key": "hung-hom-ho-man-tin", "name": "紅磡·何文田", "hans": "红磡·何文田", "en": "Hung Hom & Ho Man Tin", "center": "紅磡"},
    {"key": "tsuen-wan-kwai-tsing", "name": "荃灣·葵青", "hans": "荃湾·葵青", "en": "Tsuen Wan & Kwai Tsing", "center": "荃灣"},
    {"key": "sha-tin-tai-wai", "name": "沙田·大圍", "hans": "沙田·大围", "en": "Sha Tin & Tai Wai", "center": "沙田"},
    {"key": "ma-on-shan", "name": "馬鞍山", "hans": "马鞍山", "en": "Ma On Shan", "center": "馬鞍山"},
    {"key": "tai-po", "name": "大埔", "hans": "大埔", "en": "Tai Po", "center": "大埔墟"},
    {"key": "fanling-sheung-shui", "name": "粉嶺·上水", "hans": "粉岭·上水", "en": "Fanling & Sheung Shui", "center": "粉嶺"},
    {"key": "yuen-long", "name": "元朗", "hans": "元朗", "en": "Yuen Long", "center": "元朗"},
    {"key": "tin-shui-wai-hung-shui-kiu", "name": "天水圍·洪水橋", "hans": "天水围·洪水桥", "en": "Tin Shui Wai & Hung Shui Kiu", "center": "天水圍"},
    {"key": "tuen-mun", "name": "屯門", "hans": "屯门", "en": "Tuen Mun", "center": "屯門"},
    {"key": "tseung-kwan-o", "name": "將軍澳", "hans": "将军澳", "en": "Tseung Kwan O", "center": "將軍澳"},
    {"key": "tung-chung", "name": "東涌", "hans": "东涌", "en": "Tung Chung", "center": "東涌"},
    {"key": "hong-kong-south", "name": "港島南", "hans": "港岛南", "en": "Southern District", "center": "黃竹坑"},
    {"key": "northern-metropolis", "name": "北部都會區·新田古洞", "hans": "北部都会区·新田古洞", "en": "Northern Metropolis", "center": "落馬洲"},
]
AREA_KEYS = {a["key"] for a in AREAS}
PERIODS = {"am": "平日早高峰 08–09", "pm": "平日晚高峰 18–19", "day": "平日日常（白天平峰）", "holiday": "節假日大流量"}
MODES = {2, 3, 4}                                   # metro, metro + roads, metro + station-side development
WHAT = {"people": (-50, 150), "jobs": (-50, 150), "road_cap": (-60, 50)}   # allowed % change
ADD = {"people": (-200_000, 300_000), "jobs": (-200_000, 300_000)}           # or an absolute number (the code turns it
                                                                               # into a % with the real population / jobs)
MAX_CHANGES, MAX_YEAR = 4, 8
LANGS = {"zh-Hant", "zh-Hans", "en"}

# Canonical spellings checked against hk-base.json, not invented estate names.
# Northern Metropolis is a real menu key but its current box contains no zones.
PLACE_ALIASES = [
    {"aliases": ["启德邮轮码头", "啟德郵輪碼頭", "啓德郵輪碼頭"], "place": "啓德郵輪碼頭", "area": "kai-tak"},
    {"aliases": ["启德体育园", "啟德體育園", "kai tak stadium"], "place": "啓德站一帶", "area": "kai-tak"},
    {"aliases": ["启德", "啟德", "啓德", "kai tak"], "place": "啓德站一帶", "area": "kai-tak"},
    {"aliases": ["沙田第一城", "第一城", "city one"], "place": "第一城站一帶", "area": "sha-tin-tai-wai"},
    {"aliases": ["逸东", "逸東", "yat tung"], "place": "逸東邨", "area": "tung-chung"},
    {"aliases": ["东涌东", "東涌東", "tung chung east"], "place": "裕雅苑", "area": "tung-chung"},
    {"aliases": ["洪水桥", "洪水橋", "hung shui kiu"], "place": "洪水橋站一帶", "area": "tin-shui-wai-hung-shui-kiu"},
    {"aliases": ["北都", "北部都会区", "北部都會區", "northern metropolis"], "place": None, "area": "northern-metropolis",
     "note": "北都对应 northern-metropolis，但当前框内没有人口或岗位分区；请改用新田／古洞所在片区。当前预设框也未覆盖古洞，新田不可误认成沙田的新田圍邨；需先补框，不能借邻区人口代替。"},
]
_PLACE_TRANS = str.maketrans("啟啓東龍灣將軍門馬橋圍帶體園郵碼頭", "启启东龙湾将军门马桥围带体园邮码头")


def _norm_place(text: str) -> str:
    return re.sub(r"[\s·()（）-]", "", text.lower().translate(_PLACE_TRANS))


def _menus(names: dict | None, area: str) -> tuple[list[str], list[str]]:
    """Old arrays remain population/job menus; only typed road menus authorise road_cap."""
    entry = (names or {}).get(area, [])
    def strings(value):
        return list(dict.fromkeys(x.strip() for x in value if isinstance(x, str) and x.strip())) if isinstance(value, list) else []
    if isinstance(entry, dict):
        return strings(entry.get("places")), strings(entry.get("roads"))
    return strings(entry), []


def _sentence_aliases(sentence: str) -> list[dict]:
    text = _norm_place(sentence)
    # Keep the most specific expression: "啓德郵輪碼頭" must not become "啓德站一帶".
    hits = [(entry, max((len(_norm_place(a)) for a in entry["aliases"] if _norm_place(a) in text), default=0))
            for entry in PLACE_ALIASES]
    longest = max((n for _, n in hits), default=0)
    return [entry for entry, n in hits if n and n == longest]


def _change_supported(sentence: str, what: str) -> bool:
    """Conservative guard, not a language model: reject changes lacking the relevant explicit event.

    This catches category hallucinations (a new railway does not imply more residents/jobs).
    The 60-case scorer additionally checks place, direction, amounts, years and duplicates.
    """
    text = sentence.lower()
    text = re.sub(r"(?:不要|不)(?:再)?(?:增加|减少|減少|改变|改變)(?:人口(?:和|与|與))?(?:人口|岗位|崗位)", "", text)
    text = re.sub(r"(?:人口|居民|岗位|崗位|工作|容量|车流|車流)(?:不变|不變|维持原样|維持原樣)", "", text)
    amount = r"[了约約近再很多不少一二三四五六七八九十百千万萬亿億零两兩成半个個\d.%％,+\-\s]{0,20}"
    change = r"(?:多|少|增加|增多|减少|減少|增|减|減)"
    if what == "people":
        if re.search(r"新屋苑|新住宅|建住宅|入伙|搬入|迁入|遷入|搬走|撤离|撤離|evacuat|new (?:homes|housing)|move (?:in|out)", text):
            return True
        return bool(re.search(change + amount + r"(?:人|居民|住户|住戶)", text)
                    or re.search(r"(?:人口|居民|住的人|住户|住戶)(?:将|將|会|會|再|已|要|都|大幅)*" + r"(?:增|减|減|多|少|翻倍|上升|下降)", text)
                    or re.search(r"(?:more|fewer|less)\s+(?:residents?|people)|(?:population|residents?|people).{0,12}(?:increase|decrease|double|half)", text))
    if what == "jobs":
        if re.search(r"演唱会|演唱會|concert|展览|展覽|exhibition|围观|圍觀|购物人潮|購物人潮|建商场|建商場|開發.*商場|开发.*商场", text):
            return True
        return bool(re.search(change + amount + r"(?:岗位|崗位|工作|职位|職位)", text)
                    or re.search(r"(?:岗位|崗位|工作|职位|職位|写字楼|寫字樓|公司|商场|商場)(?:将|將|会|會|再|已|要|都|大幅)*(?:增|减|減|多|少|空置|搬去|搬走)", text)
                    or re.search(r"(?:more|fewer|less)\s+(?:jobs?|offices?)|(?:jobs?|offices?).{0,12}(?:increase|decrease|double|half)", text))
    return bool(re.search(r"封|维修|維修|扩路|擴路|扩阔|擴闊|拓宽|拓寬|容量.*(?:增|减|減|多|少)|(?:增|减|減).*容量|clos(?:e|ure)|repair|widen|capacity.*(?:increase|decrease|[+-])", text))


def system_prompt(lang: str = "zh-Hans", names: dict | None = None, mode: int | None = None) -> str:
    """The instructions for one sentence → one level request. `names`: place names inside each area, when the game has
    the Hong Kong grid loaded (then the AI must pick from them)."""
    areas = "\n".join(
        f"- {a['key']}：{a['name']}（{a['en']}，中心站 {a['center']}）"
        + (f"；人口／岗位分区：{'、'.join(_menus(names, a['key'])[0]) or '（无分区）'}"
           + f"；道路名（只供 road_cap）：{'、'.join(_menus(names, a['key'])[1]) or '（无道路菜单，不可写 road_cap）'}" if names is not None else "")
        for a in AREAS)
    aliases = "\n".join(f"- {' / '.join(a['aliases'])} → {a['place'] or '无可用分区'} / {a['area']}。{a.get('note', '')}" for a in PLACE_ALIASES)
    out_lang = {"zh-Hant": "繁體中文", "zh-Hans": "简体中文", "en": "English"}.get(lang, "简体中文")
    return f"""你是 TransitLab 香港交通游戏的「关卡助手」。玩家说一句话，你把它变成一个关卡请求。只输出一个 JSON 对象，不要别的文字。

## 你只能从菜单里选
片区 area（只能选下面的 key，不能编新片区；玩家说的地方不在里面，就选最近的一片，并在 note 里说明）：
{areas}

常见地点别名（先按明确叫法定位，再从该片菜单选同一分区；不要跳到相邻站）：
{aliases}
只说启德优先 kai-tak；明说九龍東时可用 kowloon-east，但启德人口仍只能落到啓德站一帶，不能改成九龍灣站一帶。
北都无可用人口时必须说明缺数据、建议新田／古洞所在片区；不要凭空造人口，也不要拿新田圍邨代替新田。

时段 period：am（{PERIODS['am']}）、pm（{PERIODS['pm']}）、day（{PERIODS['day']}）、holiday（{PERIODS['holiday']}）。
  说上班 / 早上 → am；下班 / 晚上 → pm；周末 / 节日 / 假期 / 演唱会 / 烟花 → holiday；白天购物 / 办事 → day；没说就用 am。
规则 mode：2（地铁）、3（地铁 + 路会塞）、4（地铁 + 站旁开发）。
- 玩家明确指定玩法时优先遵守。当前面板指定：{mode if mode is not None else '自动'}。
- 卖地 / 賣地 / 开发 / 開發 / 发展 / 發展 / 扩展 / 擴展 / 重建 / 物业 / 物業 / 新屋苑 → 4；
- 塞车 / 塞車 / 路 / 隧道 / 车流 / 車流 → 3；
- 只说修地铁 / 修地鐵 / 新线 / 新線 / 没地铁 → 2；拿不准 → 3。
- road_cap 只允许 mode 3；指定 mode 2 或 4 时不要添加 road_cap 改动。
- 英文同样适用：sell land / development / property / new housing → 4；roads / traffic / tunnel → 3；metro / new line → 2。

改动 changes：0 到 {MAX_CHANGES} 条，每条 {{"place": 地名, "what": "people"|"jobs"|"road_cap", "pct": 整数, "add": 整数, "by_year": 整数}}（pct 和 add 二选一，by_year 可省）
- changes 只能来自句子明说的变化；没说就留空 []。不能为了让关卡更难而增加人口、岗位或减少容量。
- 「东涌要修一条新地铁线」→ mode 2、changes=[]；修地铁是玩家要做的事，不代表人口和岗位增加。
- 「启德多五万人」→ 只写啓德站一帶 people add=50000；不能额外加 jobs、by_year 或换成九龙湾。
- 「东涌卖地」→ mode 4、changes=[]；只有另说建住宅／入伙或增加岗位，才有对应 people／jobs。单说塞车、上班困难、看现状同样留空。
- place：people/jobs 只能从「人口／岗位分区」选；road_cap 必须从「道路名」选中文路名，不能用站一帶、屋苑或分区代替道路。保持底板原字形（如啓德）。不要写坐标。
- what：people＝住在那里的人（新屋苑、入伙、搬走、撤离）；jobs＝去那里的吸引力（岗位、写字楼、商场、活动、演唱会、景点、围观）；road_cap＝这条路能过的车（封一条线、维修、扩路）。
- 玩家说了具体人数（「多五万人」「十万个工作」）→ 用 add 填这个数（负数＝减少），不要自己换算百分比；没说具体人数 → 用 pct。
- pct 范围：people、jobs −50 到 +150；road_cap −60 到 +50。add 范围：−200000 到 +300000。
  规模参考：小 +10～20、中 +30～50、大 +60～100、全城级 +100～150；封一条线 −30～−50；扩路 +20～+50。
- by_year：「几年后」「陆续入伙」「慢慢」这类说法才写，1～{MAX_YEAR}；马上发生就不写。

文字（title、story、note 一律用{out_lang}，只有 place 用繁體中文）：
- title：中文标题 4–10 个字，读起来像自然中文，不能压成怪缩写。好例：東涌地鐵新線、將軍澳隧道維修、啓德新增居民；坏例：將隧封線早高峰、東涌路鐵增人。lang=en 时用自然英文 4–10 个词。
- story：两句话，每句 40 个字以内，第一句说发生了什么，第二句说玩家要做什么；你选的规模是假设，要写「假设……」。除了你选的 pct，不要编别的数字。
- note：一句话，说你把哪些地方 / 规模理解成了什么（给玩家核对）。

## 虚构和香港以外
- 虚构的大事件（外星人、殭屍、怪兽、超级英雄……）照样做：把它翻译成人流变化（撤离＝那里 people 减少、某处 jobs 增加；围观＝那里 jobs 增加），在 story 里保留故事味道。
- 香港以外的地方（东京、深圳……）：选香港最像的一片做，在 note 里说「香港没有 X，用最像的 Y」。

## 不做的
只有两种情况输出 {{"refuse": "一句原因"}}：跟交通、城市、人流完全无关（写诗、股市、天气）；或者教人伤害他人、破坏设施。

## 输出格式（json）
{{"area": "kai-tak", "period": "am", "mode": 3, "changes": [{{"place": "啓德站一帶", "what": "people", "add": 50000}}], "title": "啓德新增居民", "story": ["假設啓德新增五萬名居民。", "規劃交通接通住宅與工作點。"], "note": "啓德指啓德站一帶，僅增加居民。"}}"""


def validate(obj: Any, names: dict | None = None, mode: int | None = None,
             sentence: str | None = None, lang: str = "zh-Hans") -> tuple[dict | None, list[dict], list[str]]:
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
    valid_area = isinstance(area, str) and area in AREA_KEYS
    if not valid_area:
        problems.append({"code": "area_unknown", "message": f"area {area!r} is not one of the keys"})
    mentions = _sentence_aliases(sentence or "")
    for alias in mentions:
        if alias.get("note"):
            notes.append(alias["note"])
        expected_area = alias["area"]
        explicit_ke = re.search(r"九[龍龙][東东]|kowloon east", sentence or "", re.I)
        if expected_area == "kai-tak" and explicit_ke:
            expected_area = "kowloon-east"
        if valid_area and area != expected_area and len(mentions) == 1:
            problems.append({"code": "alias_area_mismatch", "message": f"原句地点应选 {expected_area}，不能因重试换到 {area}"})
    if area == "northern-metropolis" and not _menus(names, area)[0]:
        note = PLACE_ALIASES[-1]["note"]
        if note not in notes:
            notes.append(note)
        problems.append({"code": "area_empty", "message": note})
    period = obj.get("period", "am")
    if period not in PERIODS:
        notes.append(f"period {period!r} → am")
        period = "am"
    requested_mode = mode
    mode = requested_mode if requested_mode is not None else obj.get("mode", 3)
    if type(mode) is not int or mode not in MODES:
        notes.append(f"mode {mode!r} → 3")
        mode = 3
    raw = obj.get("changes") or []
    if not isinstance(raw, list):
        raw = []
        problems.append({"code": "change_bad", "message": "changes must be a list"})
    if len(raw) > MAX_CHANGES:
        problems.append({"code": "too_many_changes", "message": f"at most {MAX_CHANGES} changes"})
    places, roads = _menus(names, area) if isinstance(area, str) else ([], [])
    seen = set()
    changes = []
    for c in raw[:MAX_CHANGES]:
        if not isinstance(c, dict) or c.get("what") not in WHAT or not str(c.get("place", "")).strip():
            problems.append({"code": "change_bad", "message": f"bad change {c!r}"})
            continue
        if c["what"] == "road_cap" and mode != 3:
            problems.append({"code": "change_mode_conflict", "message": "road_cap is supported only in mode 3; keep the requested mode and remove this change"})
            continue
        place = str(c["place"]).strip()[:80]
        if sentence is not None and not _change_supported(sentence, c["what"]):
            message = f"原句未明说 {c['what']} 变化，不应添加 {place} 的改动；没有明说的改动应留空。"
            notes.append(message)
            problems.append({"code": "unsupported_change", "message": message})
            continue
        # Resolve a common spelling only to the alias's canonical place, never a nearby zone.
        for alias in PLACE_ALIASES:
            if alias["place"] and any(_norm_place(place) == _norm_place(a) for a in alias["aliases"]):
                if c["what"] != "road_cap":
                    place = alias["place"]
                break
        for alias in mentions:
            if c["what"] != "road_cap" and alias["place"] and place != alias["place"]:
                # Explicitly named second places are legal (e.g. 逸東邨 and 裕雅苑).
                if _norm_place(place) not in _norm_place(sentence or ""):
                    problems.append({"code": "alias_place_mismatch", "message": f"{alias['aliases'][0]} 应落到 {alias['place']}，不能改为 {place}"})
                    break
        allowed = set(roads if c["what"] == "road_cap" else places) if names is not None else None
        if c["what"] == "road_cap" and not roads:
            problems.append({"code": "road_menu_missing", "message": "road_cap 必须有片区中文道路菜单，不能拿分区代替道路"})
            continue
        if allowed is not None and place not in allowed:
            problems.append({"code": "place_unknown", "message": f"{place} is not a place in {area}"})
            continue
        identity = (place, c["what"])
        if identity in seen:
            problems.append({"code": "duplicate_change", "message": f"同一地点／类型重复改动：{place} {c['what']}"})
            continue
        seen.add(identity)
        if c.get("pct") is not None and c.get("add") is not None:
            problems.append({"code": "change_bad", "message": "pct 和 add 必须二选一"})
            continue
        if c.get("add") is not None and c["what"] not in ADD:
            problems.append({"code": "change_bad", "message": "road_cap 只能用 pct"})
            continue
        if c.get("add") not in (None, "", 0) and c["what"] in ADD:
            try:
                value = float(c["add"])
                if not math.isfinite(value) or isinstance(c["add"], bool):
                    raise ValueError
                add = int(round(value))
            except (TypeError, ValueError, OverflowError):
                problems.append({"code": "change_bad", "message": f"add of {place} is not a number"})
                continue
            lo, hi = ADD[c["what"]]
            if not lo <= add <= hi:
                notes.append(f"{place} {c['what']} {add:+d} → {max(lo, min(hi, add)):+d}")
                add = max(lo, min(hi, add))
            ch = {"place": place, "what": c["what"], "add": add}
        else:
            lo, hi = WHAT[c["what"]]
            try:
                value = float(c.get("pct", 0))
                if not math.isfinite(value) or isinstance(c.get("pct"), bool):
                    raise ValueError
                pct = int(round(value))
            except (TypeError, ValueError, OverflowError):
                problems.append({"code": "change_bad", "message": f"pct of {place} is not a number"})
                continue
            if not lo <= pct <= hi:
                notes.append(f"{place} {c['what']} {pct}% → {max(lo, min(hi, pct))}%")
                pct = max(lo, min(hi, pct))
            if pct == 0:
                continue
            ch = {"place": place, "what": c["what"], "pct": pct}
        if c.get("by_year") not in (None, "", 0):
            if sentence is not None and not re.search(r"[一二两兩三四五六七八九十\d]+年|陆续|陸續|慢慢|逐步|years?|gradual", sentence, re.I):
                notes.append(f"{place} 原句未明说逐年变化，by_year dropped")
                c = {**c, "by_year": None}
            try:
                if c["by_year"] is not None:
                    ch["by_year"] = max(1, min(MAX_YEAR, int(c["by_year"])))
            except (TypeError, ValueError, OverflowError):
                notes.append(f"{place} by_year dropped")
        changes.append(ch)
    title = str(obj.get("title") or "").strip()
    story = obj.get("story") or []
    if isinstance(story, str):
        story = [story]
    story = [str(s).strip()[:80] for s in story if str(s).strip()][:2]
    if not title or not story:
        problems.append({"code": "text_missing", "message": "title and story are needed"})
    if title:
        title_length = len(re.findall(r"[A-Za-z]+(?:['’-][A-Za-z]+)*", title)) if lang == "en" else len(title)
        if not 4 <= title_length <= 10 or (lang != "en" and not re.fullmatch(r"[\u3400-\u9fff〇零一二三四五六七八九十0-9]+", title)):
            problems.append({"code": "title_length", "message": "中文标题须为自然中文 4–10 字；英文须为 4–10 词"})
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
    requested_mode = payload.get("mode")
    if requested_mode is not None and (type(requested_mode) is not int or requested_mode not in MODES):
        return _fail(400, "mode must be 2, 3 or 4 (omit it for automatic)")
    names = payload.get("names") if isinstance(payload.get("names"), dict) else None
    messages = [{"role": "system", "content": system_prompt(lang, names, requested_mode)}, {"role": "user", "content": sentence}]
    if payload.get("feedback"):
        messages.append({"role": "user", "content": "上一次的关卡不行，原因：" + json.dumps(payload["feedback"], ensure_ascii=False)[:600]
                         + "。只能在原句明说的范围内修正，保持明确的地点与人数；不得为了验收换到邻区或添加改动。缺数据时在 note 说明（仍然只输出 JSON）。"})
    t0, problems, all_notes = time.perf_counter(), [], []
    for attempt in (1, 2):
        try:
            text = await chat(messages, json_out=True)
        except AIUnavailable as exc:
            return _fail(503, str(exc))
        obj = _parse(text)
        req, problems, notes = validate(obj, names, requested_mode, sentence, lang)
        all_notes.extend(note for note in notes if note not in all_notes)
        if req:
            return {"request": req, "notes": all_notes, "attempts": attempt, "ms": round((time.perf_counter() - t0) * 1000)}
        if problems and problems[0]["code"] == "refuse":
            return _fail(422, problems[0]["message"], code="refuse")
        if any(p["code"] == "area_empty" for p in problems):
            return _fail(422, "当前片区缺少底板分区，请按提示改选或补框", code="area_empty", problems=problems, notes=all_notes)
        messages += [{"role": "assistant", "content": text[:1500]},
                     {"role": "user", "content": "这个 JSON 有问题：" + json.dumps(problems, ensure_ascii=False)[:600] + "。请改正后重新输出。"}]
    return _fail(422, "the AI could not produce a valid level request", problems=problems, notes=all_notes)


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
