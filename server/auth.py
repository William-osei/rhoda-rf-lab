"""Opt-in local lab-pilot identity, role checks and owned learning sessions.

This is not enterprise IAM. Passwords are scrypt hashes; browser authentication
uses a signed opaque HTTPOnly cookie, with server-held expiry/revocation state.
"""

import argparse
from collections import deque
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
import getpass
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
from threading import BoundedSemaphore, RLock
import time
from uuid import uuid4

from flask import Blueprint, current_app, g, jsonify, request
from itsdangerous import BadSignature, URLSafeSerializer
from werkzeug.security import check_password_hash, generate_password_hash
from request_validation import allowed_origins, valid_session_id

COOKIE_NAME = "rhoda_lab_session"
ROLES = {"viewer", "learner", "operator", "instructor", "admin"}
HASH_RE = re.compile(r"scrypt:32768:8:1\$[A-Za-z0-9]{8,64}\$[0-9a-f]{128}")
USERNAME_RE = re.compile(r"[a-z0-9][a-z0-9_.-]{0,63}")


def permissions(role):
    return {
        "readJournal": role in {"learner", "operator", "instructor", "admin"},
        "writeJournal": role in {"learner", "operator", "instructor", "admin"},
        "operateInstrument": role in {"operator", "admin"},
        "inspectAllSessions": role in {"instructor", "admin"},
        "manageUsers": False,
    }


@dataclass(frozen=True)
class User:
    username: str
    password_hash: str
    role: str
    disabled: bool = False


@dataclass
class LoginSession:
    user: User
    csrf: str
    confirmation_session: str
    learning_session: str
    expires_at: float


class AuthConfigurationError(RuntimeError):
    pass


class LoginRateLimit(ValueError):
    pass


def load_users(path):
    try:
        source = Path(path)
        if source.stat().st_size > 1024 * 1024:
            raise ValueError("User configuration is too large")
        data = json.loads(source.read_text(encoding="utf-8"))
        entries = data.get("users") if isinstance(data, dict) else None
        if not isinstance(entries, list) or not 1 <= len(entries) <= 500:
            raise ValueError("Expected 1–500 configured users")
        users = {}
        for item in entries:
            if not isinstance(item, dict):
                raise ValueError("Expected user objects")
            if set(item) - {"username", "password_hash", "role", "disabled"}:
                raise ValueError("User configuration contains unsupported fields; store password hashes only")
            name, hashed, role = item.get("username"), item.get("password_hash"), item.get("role")
            if not isinstance(name, str) or not USERNAME_RE.fullmatch(name):
                raise ValueError("Use lowercase user names containing letters, digits, dot, underscore or hyphen")
            if name in users or role not in ROLES:
                raise ValueError("Duplicate user or unsupported role")
            if not isinstance(hashed, str) or not HASH_RE.fullmatch(hashed):
                raise ValueError("Use a scrypt:32768:8:1 password hash, not a plaintext password")
            disabled = item.get("disabled", False)
            if type(disabled) is not bool:
                raise ValueError("disabled must be a boolean")
            users[name] = User(name, hashed, role, disabled)
        if not any(not user.disabled for user in users.values()):
            raise ValueError("At least one active user is required")
        return users
    except (OSError, ValueError, TypeError) as error:
        raise AuthConfigurationError("Authentication user configuration is unavailable or invalid") from error


class AuthManager:
    def __init__(self, enabled=False, secret=None, users_file=None, cookie_secure=True,
                 ttl_seconds=7200, clock=time.time):
        self.enabled = enabled
        self.cookie_secure = cookie_secure
        self.ttl = ttl_seconds
        self.clock = clock
        self.lock = RLock()
        self.sessions = {}
        self.failures = {}
        self.hash_slots = BoundedSemaphore(4)
        self.users_file = Path(users_file).resolve() if users_file else None
        self.owner_db = None
        self.users_version = None
        self.users = {}
        self.serializer = None
        self.dummy_hash = None
        if enabled:
            if not isinstance(secret, str) or len(secret) < 32 or secret.lower().startswith(("your_", "change_me", "example_")):
                raise AuthConfigurationError("RHODA_AUTH_SECRET must be a stable server secret of at least 32 characters")
            if not self.users_file:
                raise AuthConfigurationError("RHODA_AUTH_USERS_FILE is required when authentication is enabled")
            if not 300 <= ttl_seconds <= 43200:
                raise AuthConfigurationError("RHODA_AUTH_SESSION_SECONDS must be between 300 and 43200")
            self.serializer = URLSafeSerializer(secret, salt="rhoda-lab-pilot-v1")
            self.refresh_users()
            self.dummy_hash = generate_password_hash(secrets.token_urlsafe(32), method="scrypt:32768:8:1")

    @classmethod
    def from_environment(cls):
        switch = os.environ.get("RHODA_AUTH_ENABLED", "0").strip().lower()
        if switch not in ("0", "false", "no", "", "1", "true", "yes"):
            raise AuthConfigurationError("RHODA_AUTH_ENABLED must explicitly be 0 or 1")
        enabled = switch in ("1", "true", "yes")
        if not enabled:
            return cls()
        try:
            secure = os.environ.get("RHODA_AUTH_COOKIE_SECURE", "1")
            if secure not in ("0", "1"):
                raise ValueError("Cookie setting must be 0 or 1")
            return cls(True, os.environ.get("RHODA_AUTH_SECRET"), os.environ.get("RHODA_AUTH_USERS_FILE"),
                       secure == "1", int(os.environ.get("RHODA_AUTH_SESSION_SECONDS", "7200")))
        except ValueError as error:
            raise AuthConfigurationError("Invalid authentication environment settings") from error

    def bind_journal(self, path):
        if not self.enabled:
            return
        self.owner_db = str(path)
        with closing(sqlite3.connect(self.owner_db, timeout=5)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS auth_session_owners (session_id TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS auth_owner_username ON auth_session_owners(username)")

    def refresh_users(self):
        if not self.enabled:
            return
        try:
            info = self.users_file.stat()
            version = (info.st_mtime_ns, info.st_size)
        except OSError as error:
            raise AuthConfigurationError("Authentication user configuration is unavailable or invalid") from error
        with self.lock:
            if version == self.users_version:
                return
            users = load_users(self.users_file)
            # Role/password/disabled changes revoke every affected active login.
            self.sessions = {key: session for key, session in self.sessions.items()
                             if users.get(session.user.username) == session.user and not session.user.disabled}
            self.users, self.users_version = users, version

    def cookie_key(self, cookie):
        if not isinstance(cookie, str) or len(cookie) > 512:
            return None
        try:
            key = self.serializer.loads(cookie)
            return key if isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9_-]{40,64}", key) else None
        except (BadSignature, ValueError, TypeError):
            return None

    def resolve(self, cookie):
        if not self.enabled:
            return None
        self.refresh_users()
        key = self.cookie_key(cookie)
        with self.lock:
            self.prune()
            return self.sessions.get(key)

    def prune(self):
        now = self.clock()
        self.sessions = {key: session for key, session in self.sessions.items() if session.expires_at > now}
        self.failures = {key: deque(stamp for stamp in stamps if now - stamp < 60)
                         for key, stamps in self.failures.items() if stamps and now - stamps[-1] < 60}

    def create_learning_session(self, session):
        sid = "session_" + uuid4().hex
        if not self.owner_db:
            raise AuthConfigurationError("Authentication journal ownership is unavailable")
        with closing(sqlite3.connect(self.owner_db, timeout=5)) as db, db:
            db.execute("INSERT INTO auth_session_owners VALUES (?, ?, ?)",
                       (sid, session.user.username, datetime.now(timezone.utc).isoformat()))
        session.learning_session = sid
        return sid

    def owns(self, username, sid):
        if not valid_session_id(sid) or not self.owner_db:
            return False
        with closing(sqlite3.connect(self.owner_db, timeout=5)) as db, db:
            row = db.execute("SELECT username FROM auth_session_owners WHERE session_id=?", (sid,)).fetchone()
        return row is not None and row[0] == username

    def login(self, username, password, remote_addr, old_cookie=None):
        self.refresh_users()
        if not isinstance(username, str) or not isinstance(password, str) or not 1 <= len(password) <= 1024:
            raise ValueError("Invalid username or password")
        username = username.strip().lower()
        if len(username) > 64:
            username = "invalid"
        keys = (("ip", remote_addr), ("user", username))
        with self.lock:
            self.prune()
            if any(len(self.failures.get(key, ())) >= (20 if key[0] == "ip" else 10) for key in keys):
                raise LoginRateLimit("Too many login attempts. Wait one minute before retrying.")
            # Reserve the attempt before the expensive hash, so parallel requests
            # cannot all pass the limit while earlier hashes are still running.
            if len(self.failures) + sum(key not in self.failures for key in keys) > 2048:
                raise LoginRateLimit("Too many login attempts. Wait one minute before retrying.")
            for key in keys:
                self.failures.setdefault(key, deque()).append(self.clock())
            user = self.users.get(username)
        # Verify an equivalent-cost dummy hash for unknown/disabled usernames.
        if not self.hash_slots.acquire(blocking=False):
            raise LoginRateLimit("Lab sign-in is busy. Wait one minute before retrying.")
        try:
            valid = check_password_hash(user.password_hash if user and not user.disabled else self.dummy_hash, password)
        finally:
            self.hash_slots.release()
        # A credential/role change while a hash was running must also revoke
        # this login, before it can issue a cookie.
        self.refresh_users()
        with self.lock:
            if not valid or not user or user.disabled or self.users.get(username) != user:
                raise ValueError("Invalid username or password")
            if len(self.sessions) >= 1024:
                raise AuthConfigurationError("Too many active authentication sessions")
            session = LoginSession(user, secrets.token_urlsafe(32), "auth_" + uuid4().hex, "", self.clock() + self.ttl)
            self.create_learning_session(session)
            self.logout(old_cookie)
            key = secrets.token_urlsafe(32)
            self.sessions[key] = session
            return self.serializer.dumps(key), session

    def logout(self, cookie):
        key = self.cookie_key(cookie)
        with self.lock:
            self.sessions.pop(key, None)

    def status(self, session=None):
        if not self.enabled:
            return {"enabled": False, "authenticated": False, "user": None, "csrfToken": None,
                    "sessionId": None, "expiresAt": None, "permissions": {**permissions("admin"), "manageUsers": False}}
        return {"enabled": True, "authenticated": session is not None,
                "user": {"username": session.user.username, "role": session.user.role} if session else None,
                "csrfToken": session.csrf if session else None,
                "sessionId": session.learning_session if session else None,
                "expiresAt": datetime.fromtimestamp(session.expires_at, timezone.utc).isoformat() if session else None,
                "permissions": permissions(session.user.role) if session else permissions("viewer"),
                "cookieSecure": self.cookie_secure}


auth = Blueprint("auth", __name__)


def manager():
    return current_app.extensions["rhoda_auth"]


def auth_error(message, code, status):
    return jsonify({"ok": False, "ack": False, "error": message, "code": code}), status


def protect_request():
    if not request.path.startswith("/api/"):
        return None
    state = manager()
    if not state.enabled:
        return None
    origin = request.headers.get("Origin")
    if origin and origin not in allowed_origins():
        return auth_error("Origin not allowed", "origin_denied", 403)
    if request.method == "OPTIONS":
        return None
    if request.path in ("/api/auth/status", "/api/auth/login", "/api/desktop/exit"):
        return None
    try:
        session = state.resolve(request.cookies.get(COOKIE_NAME))
        if not session:
            return auth_error("Sign in to access this lab", "auth_required", 401)
        g.auth_session = session
        rights = permissions(session.user.role)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            provided = request.headers.get("X-Rhoda-CSRF", "")
            if len(provided) > 128 or not hmac.compare_digest(provided.encode(), session.csrf.encode()):
                return auth_error("The login security token is missing or expired. Refresh your login and retry.", "invalid_csrf", 403)
        if request.path == "/api/auth/logout":
            return None
        if request.path == "/api/auth/session":
            if not rights["writeJournal"]:
                return auth_error("Your role cannot start learning sessions", "permission_denied", 403)
            return None
        if request.path.startswith("/api/session/"):
            if request.method in ("GET", "HEAD"):
                if not rights["readJournal"]:
                    return auth_error("Your role cannot read session journals", "permission_denied", 403)
                sid = request.args.get("session_id")
                if sid is not None and not valid_session_id(sid):
                    return auth_error("Invalid session ID", "invalid_session", 400)
                if not rights["inspectAllSessions"]:
                    sid = sid if sid is not None else session.learning_session
                    if not state.owns(session.user.username, sid):
                        return auth_error("That session belongs to a different lab account", "session_denied", 403)
                g.auth_session_filter = sid
            else:
                if not rights["writeJournal"]:
                    return auth_error("Your role cannot write session journals", "permission_denied", 403)
                body = request.get_json(silent=True)
                if not isinstance(body, dict) or not state.owns(session.user.username, body.get("session_id")):
                    return auth_error("Use a learning session issued to your account", "session_denied", 403)
        is_instrument = request.path.startswith("/api/instrument/") or request.path in ("/api/set", "/api/measure", "/api/confirm")
        if request.method not in ("GET", "HEAD") and (is_instrument or request.path.startswith("/api/training/")):
            if not rights["operateInstrument"]:
                return auth_error("Only an operator or administrator can change instrument or training settings", "permission_denied", 403)
            sid = request.headers.get("X-Rhoda-Session", "")
            if not state.owns(session.user.username, sid):
                return auth_error("Use a learning session issued to your account", "session_denied", 403)
            if request.path != "/api/instrument/cancel" and sid != session.learning_session:
                return auth_error("Use your current learning session for instrument or training changes", "session_denied", 403)
    except (AuthConfigurationError, sqlite3.Error):
        return auth_error("Lab authentication is unavailable. Ask the lab administrator to check configuration.", "auth_unavailable", 503)
    return None


@auth.get("/api/auth/status")
def auth_status():
    state = manager()
    try:
        result = state.status(state.resolve(request.cookies.get(COOKIE_NAME))) if state.enabled else state.status()
        response = jsonify(result)
        response.headers["Cache-Control"] = "no-store"
        return response
    except (AuthConfigurationError, sqlite3.Error):
        return jsonify({**state.status(), "configured": False, "error": "Lab authentication configuration is unavailable"}), 503


@auth.post("/api/auth/login")
def auth_login():
    state = manager()
    if not state.enabled:
        return auth_error("Lab sign-in is not enabled", "auth_disabled", 409)
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or (request.content_length and request.content_length > 8192):
        return auth_error("Expected a username and password JSON object", "invalid_request", 400)
    try:
        cookie, session = state.login(body.get("username"), body.get("password"), request.remote_addr, request.cookies.get(COOKIE_NAME))
        response = jsonify({"ok": True, **state.status(session)})
        response.set_cookie(COOKIE_NAME, cookie, max_age=state.ttl, secure=state.cookie_secure,
                            httponly=True, samesite="Strict", path="/api")
        response.headers["Cache-Control"] = "no-store"
        return response
    except LoginRateLimit as error:
        response = jsonify({"ok": False, "error": str(error), "code": "login_rate_limit"})
        response.headers["Retry-After"] = "60"
        return response, 429
    except ValueError:
        return auth_error("Invalid username or password", "login_failed", 401)
    except (AuthConfigurationError, sqlite3.Error):
        return auth_error("Lab authentication is unavailable. Ask the lab administrator to check configuration.", "auth_unavailable", 503)


@auth.post("/api/auth/logout")
def auth_logout():
    state = manager()
    if not state.enabled:
        return auth_error("Lab sign-in is not enabled", "auth_disabled", 409)
    state.logout(request.cookies.get(COOKIE_NAME))
    response = jsonify({"ok": True, **state.status()})
    response.delete_cookie(COOKIE_NAME, path="/api", secure=state.cookie_secure, httponly=True, samesite="Strict")
    response.headers["Cache-Control"] = "no-store"
    return response


@auth.post("/api/auth/session")
def auth_new_session():
    state = manager()
    if not state.enabled:
        return auth_error("Lab sign-in is not enabled", "auth_disabled", 409)
    try:
        with state.lock:
            state.create_learning_session(g.auth_session)
        response = jsonify({"ok": True, **state.status(g.auth_session)})
        response.headers["Cache-Control"] = "no-store"
        return response
    except (AuthConfigurationError, sqlite3.Error):
        return auth_error("The learning session could not be created. Retry when the journal is available.", "journal_unavailable", 503)


def configure(app):
    # Validate before app.py can initialize any physical instrument connection.
    state = AuthManager.from_environment()
    app.extensions["rhoda_auth"] = state
    app.register_blueprint(auth)
    app.before_request(protect_request)
    return state


def bootstrap_user():
    parser = argparse.ArgumentParser(description="Add/update one local lab user with a prompted scrypt password")
    parser.add_argument("--users-file", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--role", required=True, choices=sorted(ROLES))
    args = parser.parse_args()
    name = args.username.strip().lower()
    if not USERNAME_RE.fullmatch(name):
        parser.error("Use a lowercase username containing letters, digits, dot, underscore or hyphen")
    password = getpass.getpass("Password (at least 12 characters): ")
    if len(password) < 12 or len(password) > 1024 or password != getpass.getpass("Repeat password: "):
        parser.error("Passwords must match and contain 12–1024 characters")
    path = Path(args.users_file).resolve()
    if path.exists():
        users = load_users(path)
        entries = [{"username": user.username, "password_hash": user.password_hash, "role": user.role, "disabled": user.disabled}
                   for user in users.values() if user.username != name]
    else:
        entries = []
    entries.append({"username": name, "password_hash": generate_password_hash(password, method="scrypt:32768:8:1"), "role": args.role})
    path.parent.mkdir(parents=True, exist_ok=True)
    # Replace atomically so a running server never reads a half-written file.
    temporary = path.with_name(path.name + ".new")
    temporary.write_text(json.dumps({"users": entries}, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
    print(f"Updated hashed user configuration: {path}")


if __name__ == "__main__":
    bootstrap_user()
