"""Leaderboard storage for the v7 feeder challenge levels.

The v7 browser sends a small replay plan rather than the line-drawing game's
``Submission`` shape.  This service keeps that contract separate from the
older simple/complex map leaderboard while using the same account database.
The browser only exposes challenge levels, and the API validates the level id,
score and JSON size before storing the plan.
"""

import json
import math
import re
import time
import uuid
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.services.accounts import User
from backend.services.db import Database

FEEDER_MODE_RE = re.compile(r"^feeder/m(?:[1-5](?:-bus)?)/[a-z0-9][a-z0-9-]*$")
KEEP_PER_PLAYER = 20
MAX_PLAN_BYTES = 100_000


class FeederSubmission(BaseModel):
    """The body emitted by ``game-feeder/v7/shared/board.js``."""

    mode: str = Field(min_length=10, max_length=120)
    score: float
    plan: dict[str, Any]
    lang: str = Field(default="zh-Hant", min_length=1, max_length=20)

    @field_validator("mode")
    @classmethod
    def mode_ok(cls, value: str) -> str:
        value = value.strip()
        if not FEEDER_MODE_RE.fullmatch(value):
            raise ValueError("不是有效的 feeder 关卡编号")
        return value

    @field_validator("score")
    @classmethod
    def score_ok(cls, value: float) -> float:
        if not math.isfinite(value) or not -1_000_000_000 <= value <= 1_000_000_000:
            raise ValueError("成绩超出范围")
        return value

    @field_validator("lang")
    @classmethod
    def lang_ok(cls, value: str) -> str:
        return value.strip()[:20] or "zh-Hant"

    @model_validator(mode="after")
    def plan_ok(self) -> "FeederSubmission":
        try:
            encoded = json.dumps(self.plan, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        except (TypeError, ValueError) as exc:
            raise ValueError("方案不是有效的 JSON") from exc
        if len(encoded.encode("utf-8")) > MAX_PLAN_BYTES:
            raise ValueError("方案太大了")
        if not self.plan:
            raise ValueError("方案不能为空")
        return self


class FeederEntry(BaseModel):
    id: str
    user_id: int
    name: str
    username: str
    mode: str
    score: float
    lang: str
    created_at: float
    rank: int


class FeederBoard(BaseModel):
    mode: str
    total_players: int
    entries: list[FeederEntry]
    me: FeederEntry | None = None


class FeederSubmitResult(BaseModel):
    ok: bool = True
    entry: FeederEntry
    rank: int
    total_players: int
    personal_best: bool


_RANKED = """
WITH best AS (
    SELECT e.*, u.username AS name,
           ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.score DESC, e.created_at) AS mine
    FROM feeder_entries e JOIN users u ON u.id = e.user_id
    WHERE e.mode = ?
)
SELECT *, ROW_NUMBER() OVER (ORDER BY score DESC, created_at) AS rank
FROM best WHERE mine = 1
"""


def _entry(row) -> FeederEntry:
    return FeederEntry(
        id=row["id"], user_id=row["user_id"], name=row["name"], username=row["name"],
        mode=row["mode"], score=row["score"], lang=row["lang"],
        created_at=row["created_at"], rank=row["rank"],
    )


class FeederLeaderboard:
    def __init__(self, db: Database):
        self.db = db

    def board(self, mode: str, limit: int = 50, user: User | None = None) -> FeederBoard:
        with self.db.connect() as db:
            rows = db.execute(f"SELECT * FROM ({_RANKED}) ORDER BY rank LIMIT ?", (mode, limit)).fetchall()
            total = db.execute(
                "SELECT COUNT(DISTINCT user_id) FROM feeder_entries WHERE mode = ?", (mode,)
            ).fetchone()[0]
            me = None
            if user is not None:
                me = db.execute(f"SELECT * FROM ({_RANKED}) WHERE user_id = ?", (mode, user.id)).fetchone()
        return FeederBoard(mode=mode, total_players=total, entries=[_entry(row) for row in rows],
                           me=_entry(me) if me else None)

    def submit(self, user: User, sub: FeederSubmission) -> FeederSubmitResult:
        now = time.time()
        entry_id = uuid.uuid4().hex
        plan = json.dumps(sub.plan, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        with self.db.connect() as db:
            before = db.execute(
                "SELECT MAX(score) FROM feeder_entries WHERE user_id = ? AND mode = ?",
                (user.id, sub.mode),
            ).fetchone()[0]
            db.execute(
                "INSERT INTO feeder_entries (id, user_id, mode, score, created_at, lang, plan) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (entry_id, user.id, sub.mode, sub.score, now, sub.lang, plan),
            )
            db.execute(
                """DELETE FROM feeder_entries WHERE user_id = ? AND mode = ? AND id NOT IN (
                       SELECT id FROM feeder_entries WHERE user_id = ? AND mode = ?
                       ORDER BY score DESC, created_at LIMIT ?)""",
                (user.id, sub.mode, user.id, sub.mode, KEEP_PER_PLAYER),
            )
            me = db.execute(f"SELECT * FROM ({_RANKED}) WHERE user_id = ?", (sub.mode, user.id)).fetchone()
            total = db.execute(
                "SELECT COUNT(DISTINCT user_id) FROM feeder_entries WHERE mode = ?", (sub.mode,)
            ).fetchone()[0]
        entry = FeederEntry(
            id=entry_id, user_id=user.id, name=user.username, username=user.username,
            mode=sub.mode, score=sub.score, lang=sub.lang, created_at=now, rank=me["rank"],
        )
        return FeederSubmitResult(entry=entry, rank=me["rank"], total_players=total,
                                  personal_best=before is None or sub.score > before)

    def mine(self, mode: str, user: User) -> dict[str, FeederEntry | None]:
        with self.db.connect() as db:
            row = db.execute(f"SELECT * FROM ({_RANKED}) WHERE user_id = ?", (mode, user.id)).fetchone()
        return {"entry": _entry(row) if row else None}
