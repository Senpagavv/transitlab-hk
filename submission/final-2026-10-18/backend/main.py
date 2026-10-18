"""Small production-minded API for the second TransitLab sandbox host.

The browser only receives same-origin endpoints.  The DeepSeek key is read
from the server environment by ``feeder_ai`` and is never included in the
static game files.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import smtplib
import sqlite3
import time
from email.message import EmailMessage
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from backend.feeder_ai import router as feeder_ai_router

load_dotenv()
ROOT = Path(__file__).resolve().parents[1]
FEEDER = ROOT / "game-feeder" / "v7-deploy"
DATA = ROOT / "data" / "app"
DATA.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.getenv("GAME_DB_PATH") or (DATA / "sandbox.db"))
COOKIE = "tlhk_session"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"


def db() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.executescript("""
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0,
        created_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS codes(email TEXT NOT NULL, kind TEXT NOT NULL, code TEXT NOT NULL, expires REAL NOT NULL,
        PRIMARY KEY(email, kind));
      CREATE TABLE IF NOT EXISTS scores(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, mode TEXT NOT NULL,
        score REAL NOT NULL, challenge TEXT, created_at REAL NOT NULL);
    """)
    return c


def pw_hash(password: str) -> str:
    salt = secrets.token_bytes(16)
    return salt.hex() + ":" + hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1).hex()


def pw_ok(password: str, saved: str) -> bool:
    try:
        salt_hex, digest = saved.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        actual = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1).hex()
        return hmac.compare_digest(actual, digest)
    except Exception:
        return False


def smtp_ready() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD"))


def send_code(email: str, code: str, purpose: str) -> bool:
    if not smtp_ready():
        return False
    msg = EmailMessage()
    msg["Subject"] = "TransitLab HK 验证码"
    msg["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER")
    msg["To"] = email
    msg.set_content(f"TransitLab HK {purpose}验证码：{code}\n10 分钟内有效。")
    host, port = os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", "465"))
    with smtplib.SMTP_SSL(host, port, timeout=20) as server:
        server.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD"))
        server.send_message(msg)
    return True


def user_from(request: Request):
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    with db() as c:
        row = c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?", (token, time.time())).fetchone()
    return row


def public_user(row):
    return {"id": row["id"], "username": row["username"], "email": row["email"], "verified": bool(row["verified"])} if row else None


app = FastAPI(title="TransitLab HK Sandbox API", version="2026.10.18")
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.include_router(feeder_ai_router)

# Keep AI requests bounded on an IP basis so a public demo cannot spend the
# entire DeepSeek balance from a single browser or script.
_hits: dict[tuple[str, str], list[float]] = {}
@app.middleware("http")
async def ai_rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/feeder/ai/") and request.method == "POST":
        key = (request.client.host if request.client else "unknown", request.url.path)
        now = time.time(); bucket = [x for x in _hits.get(key, []) if x > now - 60]
        limit = 10 if request.url.path.endswith("/level") else 20
        if len(bucket) >= limit:
            return Response(json.dumps({"message": "请求过于频繁，请一分钟后再试。"}, ensure_ascii=False), status_code=429, media_type="application/json")
        bucket.append(now); _hits[key] = bucket
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"status": "ok", "ai": bool(os.getenv("DEEPSEEK_API_KEY"))}


@app.get("/api/auth/me")
def me(request: Request):
    return {"user": public_user(user_from(request))}


@app.post("/api/auth/register")
def register(payload: dict, response: Response):
    username, email, password = str(payload.get("username") or "").strip(), str(payload.get("email") or "").strip().lower(), str(payload.get("password") or "")
    if len(username) < 2 or len(username) > 20 or "@" not in email or len(password) < 8:
        raise HTTPException(400, "用户名、邮箱或密码格式不正确")
    with db() as c:
        try:
            verified = 0 if smtp_ready() else 1
            c.execute("INSERT INTO users(username,email,password_hash,verified,created_at) VALUES(?,?,?,?,?)", (username, email, pw_hash(password), verified, time.time()))
            uid = c.execute("SELECT last_insert_rowid()").fetchone()[0]
            code = f"{secrets.randbelow(1000000):06d}"
            c.execute("INSERT OR REPLACE INTO codes(email,kind,code,expires) VALUES(?,?,?,?)", (email, "verify", code, time.time() + 600))
            c.commit(); row = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        except sqlite3.IntegrityError:
            raise HTTPException(409, "用户名或邮箱已注册")
    sent = False
    if smtp_ready():
        try: sent = send_code(email, code, "注册")
        except Exception: sent = False
    result = login_user(row, response)
    result["email_sent"] = sent
    return result


def login_user(row, response: Response):
    token = secrets.token_urlsafe(32)
    with db() as c:
        c.execute("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)", (token, row["id"], time.time() + 60 * 60 * 24 * 30)); c.commit()
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", secure=COOKIE_SECURE, max_age=60 * 60 * 24 * 30)
    return {"user": public_user(row)}


@app.post("/api/auth/login")
def login(payload: dict, response: Response):
    identity, password = str(payload.get("login") or "").strip().lower(), str(payload.get("password") or "")
    with db() as c: row = c.execute("SELECT * FROM users WHERE lower(username)=? OR lower(email)=?", (identity, identity)).fetchone()
    if not row or not pw_ok(password, row["password_hash"]): raise HTTPException(401, "账号或密码不正确")
    if not row["verified"]: raise HTTPException(403, "请先验证邮箱")
    return login_user(row, response)


@app.post("/api/auth/verify")
def verify(payload: dict, request: Request, response: Response):
    code = str(payload.get("code") or "").strip(); row = user_from(request)
    if not row: raise HTTPException(401, "请先登录")
    with db() as c: saved = c.execute("SELECT * FROM codes WHERE email=? AND kind='verify' AND expires>?", (row["email"], time.time())).fetchone()
    if not saved or not hmac.compare_digest(code, saved["code"]): raise HTTPException(400, "验证码不正确或已过期")
    with db() as c: c.execute("UPDATE users SET verified=1 WHERE id=?", (row["id"],)); c.commit()
    with db() as c: fresh = c.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    return login_user(fresh, response)


def issue_code(email: str, kind: str) -> bool:
    code = f"{secrets.randbelow(1000000):06d}"
    with db() as c:
        c.execute("INSERT OR REPLACE INTO codes(email,kind,code,expires) VALUES(?,?,?,?)", (email, kind, code, time.time() + 600)); c.commit()
    try: return send_code(email, code, "找回密码" if kind == "reset" else "验证") if smtp_ready() else False
    except Exception: return False


@app.post("/api/auth/resend")
def resend(request: Request):
    row = user_from(request)
    if not row: raise HTTPException(401, "请先登录")
    return {"email_sent": issue_code(row["email"], "verify")}


@app.post("/api/auth/forgot")
def forgot(payload: dict):
    email = str(payload.get("email") or "").strip().lower()
    with db() as c: row = c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    sent = bool(row and issue_code(email, "reset"))
    return {"email_sent": sent}


@app.post("/api/auth/reset")
def reset_password(payload: dict, response: Response):
    email = str(payload.get("email") or "").strip().lower(); code = str(payload.get("code") or "").strip(); password = str(payload.get("password") or "")
    if len(password) < 8: raise HTTPException(400, "密码至少 8 位")
    with db() as c: saved = c.execute("SELECT * FROM codes WHERE email=? AND kind='reset' AND expires>?", (email, time.time())).fetchone(); row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
    if not row or not saved or not hmac.compare_digest(code, saved["code"]): raise HTTPException(400, "验证码不正确或已过期")
    with db() as c: c.execute("UPDATE users SET password_hash=?,verified=1 WHERE id=?", (pw_hash(password), row["id"])); c.commit()
    with db() as c: fresh = c.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()
    return login_user(fresh, response)


@app.get("/api/game/leaderboard")
def leaderboard(mode: str = "feeder/m5/sandbox", limit: int = 20):
    with db() as c: rows = c.execute("SELECT u.username, s.score, s.challenge FROM scores s JOIN users u ON u.id=s.user_id WHERE s.mode=? ORDER BY s.score DESC, s.created_at ASC LIMIT ?", (mode, min(50, max(1, limit)))).fetchall()
    return {"entries": [{"rank": i + 1, "name": r["username"], "score": r["score"], "challenge": r["challenge"] or "—"} for i, r in enumerate(rows)]}


@app.post("/api/game/leaderboard")
def submit_score(payload: dict, request: Request):
    row = user_from(request)
    if not row: raise HTTPException(401, "请先登录后再提交成绩")
    mode = str(payload.get("mode") or "feeder/m5/sandbox")[:80]; score = max(0, min(1000, float(payload.get("score") or 0))); challenge = str(payload.get("challenge") or "")[:120]
    with db() as c: c.execute("INSERT INTO scores(user_id,mode,score,challenge,created_at) VALUES(?,?,?,?,?)", (row["id"], mode, score, challenge, time.time())); c.commit()
    return {"ok": True}


app.mount("/feeder", StaticFiles(directory=FEEDER, html=True, check_dir=False), name="feeder")
app.mount("/", StaticFiles(directory=FEEDER, html=True, check_dir=False), name="site")
