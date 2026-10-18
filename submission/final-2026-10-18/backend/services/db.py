"""The game's database: players, their login sessions, email codes and leaderboard scores.

One SQLite file (Python's built-in sqlite3, no server to run). Accounts are not regenerable data, so
the file lives in data/app/ (not data/cache/) and is kept out of Git. Every call opens its own
connection: FastAPI runs sync endpoints on a thread pool, and SQLite's WAL mode lets readers and
one writer work side by side.
"""

import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE,
    pw_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS codes (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,            -- 'verify' (email) or 'reset' (password)
    code_hash TEXT NOT NULL,
    expires_at REAL NOT NULL,
    sent_at REAL NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, purpose)
);
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    budget INTEGER NOT NULL,
    score REAL NOT NULL,
    created_at REAL NOT NULL,
    data TEXT NOT NULL                -- JSON: metrics, path, stations, from/to names
);
CREATE INDEX IF NOT EXISTS entries_board ON entries(mode, budget, score DESC);
CREATE TABLE IF NOT EXISTS feeder_entries (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    score REAL NOT NULL,
    created_at REAL NOT NULL,
    lang TEXT NOT NULL DEFAULT 'zh-Hant',
    plan TEXT NOT NULL                -- JSON: the minimal replay plan from the feeder game
);
CREATE INDEX IF NOT EXISTS feeder_entries_board ON feeder_entries(mode, score DESC, created_at);
"""


class Database:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:  # commit on success, roll back on error
                yield db
        finally:
            db.close()
