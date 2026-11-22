"""Durable local event journal. Event IDs make browser retries idempotent."""

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from contextlib import contextmanager
from request_validation import valid_session_id


class SessionStore:
    def __init__(self, path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, payload TEXT NOT NULL)"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS events_session ON events(session_id)"
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        try:
            with db:
                yield db
        finally:
            db.close()

    def append(self, event):
        if not isinstance(event, dict):
            raise ValueError("Expected event object")
        d = dict(event)
        sid = d.get("session_id")
        if not valid_session_id(sid):
            raise ValueError("Invalid session ID")
        if d.get("role") not in ("user", "assistant", "system", "tool"):
            raise ValueError("Invalid event role")
        if not isinstance(d.get("content"), str) or len(d["content"]) > 20000:
            raise ValueError("Event content must be text of at most 20000 characters")
        if "tool_call" in d and not isinstance(d["tool_call"], dict):
            raise ValueError("tool_call must be an object")
        if "confirmed" in d and type(d["confirmed"]) is not bool:
            raise ValueError("confirmed must be a boolean")
        if "topic" in d and (not isinstance(d["topic"], str) or len(d["topic"]) > 128):
            raise ValueError("Invalid topic")
        if "timestamp" in d and (
            not isinstance(d["timestamp"], str) or len(d["timestamp"]) > 64
        ):
            raise ValueError("Invalid timestamp")
        eid = d.setdefault("event_id", str(uuid.uuid4()))
        if not isinstance(eid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", eid):
            raise ValueError("Invalid event ID")
        d.pop("server_timestamp", None)
        encoded = json.dumps(d, allow_nan=False)
        if len(encoded) > 65536:
            raise ValueError("Event too large")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute(
                "SELECT payload FROM events WHERE event_id=?", (eid,)
            ).fetchone()
            if existing:
                previous = json.loads(existing[0])
                previous.pop("server_timestamp", None)
                if previous != d:
                    raise ValueError("Event ID already exists with different content")
                return False
            d["server_timestamp"] = datetime.now(timezone.utc).isoformat()
            db.execute(
                "INSERT INTO events VALUES (?, ?, ?)",
                (eid, sid, json.dumps(d, allow_nan=False)),
            )
        return True

    def snapshot(self, session_id=None):
        """One coherent snapshot; filtered queries use the session index."""
        if session_id is not None and not valid_session_id(session_id):
            raise ValueError("Invalid session ID")
        with self.connect() as db:
            if session_id is None:
                rows = db.execute("SELECT payload FROM events ORDER BY rowid").fetchall()
            else:
                rows = db.execute("SELECT payload FROM events WHERE session_id=? ORDER BY rowid", (session_id,)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def __iter__(self):
        return iter(self.snapshot())

    def __len__(self):
        with self.connect() as db:
            return db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
