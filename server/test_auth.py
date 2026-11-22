"""Opt-in lab auth regression. Temporary accounts, journals and fake scopes only."""

import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock

from werkzeug.security import generate_password_hash
from flask import Flask
from flask_cors import CORS

import app as module
from auth import AuthManager, AuthConfigurationError, LoginRateLimit, COOKIE_NAME, auth, protect_request
from instrument.scope_client import build_mock_client
from session_store import SessionStore

PASSWORD = "Synthetic test password 123!"


class PilotAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hashed = generate_password_hash(PASSWORD, method="scrypt:32768:8:1")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.users_path = self.root / "users.json"
        self.users = [{"username": role, "role": role, "password_hash": self.hashed} for role in ("viewer", "learner", "operator", "instructor", "admin")]
        self.users.append({"username": "learner2", "role": "learner", "password_hash": self.hashed})
        self.users_path.write_text(json.dumps({"users": self.users}), encoding="utf-8")
        self.clock = [1700000000.0]
        self.manager = AuthManager(True, "synthetic-stable-secret-for-tests-0123456789", self.users_path, clock=lambda: self.clock[0])
        self.store = SessionStore(self.root / "journal.sqlite3")
        self.manager.bind_journal(self.store.path)
        self.old_manager = module.app.extensions["rhoda_auth"]
        self.saved = module.scope, module.instrument_mode, module.instrument_error, module.session_logs
        module.app.extensions["rhoda_auth"] = self.manager
        module.scope, module.instrument_mode, module.instrument_error, module.session_logs = build_mock_client(), "mock", None, self.store
        module.app.config["TESTING"] = True
        self.client = module.app.test_client()
        self.identity = None

    def tearDown(self):
        module.app.extensions["rhoda_auth"] = self.old_manager
        module.scope, module.instrument_mode, module.instrument_error, module.session_logs = self.saved
        self.temporary.cleanup()

    def login(self, username="operator", client=None):
        target = client or self.client
        result = target.post("/api/auth/login", json={"username": username, "password": PASSWORD})
        self.assertEqual(result.status_code, 200, result.json)
        if target is self.client:
            self.identity = result.json
        return result.json

    def headers(self, identity=None):
        identity = identity or self.identity
        return {"X-Rhoda-CSRF": identity["csrfToken"], "X-Rhoda-Session": identity["sessionId"]}

    def post(self, path, body, headers=None):
        return self.client.post(path, json=body, headers=self.headers() if headers is None else headers)

    def log(self, content="trigger lesson", identity=None, client=None):
        identity = identity or self.identity
        return (client or self.client).post("/api/session/log", json={"session_id": identity["sessionId"], "role": "user", "content": content}, headers=self.headers(identity))

    def rewrite_users(self):
        previous = self.users_path.stat().st_mtime_ns
        self.users_path.write_text(json.dumps({"users": self.users}), encoding="utf-8")
        os.utime(self.users_path, ns=(previous + 1000000, previous + 1000000))

    def test_disabled_default_preserves_anonymous_simulator(self):
        module.app.extensions["rhoda_auth"] = AuthManager()
        status = self.client.get("/api/auth/status").json
        self.assertEqual((status["enabled"], status["authenticated"], status["sessionId"], status["csrfToken"]), (False, False, None, None))
        self.assertTrue(self.client.get("/api/instrument/state").json["ok"])
        self.assertEqual(self.client.post("/api/auth/login", json={}).status_code, 409)

    def test_missing_or_invalid_auth_config_fails_closed(self):
        for values in ({"RHODA_AUTH_ENABLED": "1", "RHODA_AUTH_SECRET": "", "RHODA_AUTH_USERS_FILE": ""},
                       {"RHODA_AUTH_ENABLED": "maybe"},
                       {"RHODA_AUTH_ENABLED": "1", "RHODA_AUTH_SECRET": "short", "RHODA_AUTH_USERS_FILE": str(self.users_path)},
                       {"RHODA_AUTH_ENABLED": "1", "RHODA_AUTH_SECRET": "x" * 32, "RHODA_AUTH_USERS_FILE": str(self.users_path), "RHODA_AUTH_COOKIE_SECURE": "maybe"}):
            with self.subTest(values=values), patch.dict("os.environ", values, clear=True):
                with self.assertRaises(AuthConfigurationError):
                    AuthManager.from_environment()
        self.users[0]["password_hash"] = "plaintext is not configuration"
        self.rewrite_users()
        with self.assertRaises(AuthConfigurationError):
            AuthManager(True, "x" * 32, self.users_path)

    def test_plaintext_supplemental_config_is_not_accepted(self):
        self.users[0]["password"] = PASSWORD
        self.rewrite_users()
        with self.assertRaises(AuthConfigurationError):
            AuthManager(True, "x" * 32, self.users_path)

    def test_unavailable_ownership_journal_stops_before_instrument_initialization(self):
        source = """
import sqlite3
import sys
sys.path.insert(0, 'server')
import instrument.scope_client as scope
called = []
def forbidden_connection(*args, **kwargs):
    called.append(True)
    raise AssertionError('Instrument builder must not run')
scope.build_rs_instrument_client = forbidden_connection
try:
    import app
except sqlite3.OperationalError:
    assert not called, 'Unavailable auth journal attempted an instrument connection'
else:
    raise AssertionError('Invalid journal did not stop startup')
"""
        env = {**os.environ, "RHODA_AUTH_ENABLED": "1", "RHODA_AUTH_SECRET": "synthetic-startup-test-secret-0123456789",
               "RHODA_AUTH_USERS_FILE": str(self.users_path), "RHODA_SESSION_DB": str(self.root),
               "RHODA_AI_ENABLED": "0", "SCOPE_RESOURCE": "fake-resource-never-connected"}
        result = subprocess.run([sys.executable, "-X", "utf8", "-c", source],
                                cwd=Path(__file__).resolve().parent.parent, env=env,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("connecting to", result.stdout)

    def test_anonymous_is_denied_but_status_and_preflight_are_available(self):
        status = self.client.get("/api/auth/status")
        self.assertEqual(status.status_code, 200)
        self.assertFalse(status.json["authenticated"])
        self.assertNotIn("users", status.json)
        for path in ("/api/health", "/api/instrument/state", "/api/session/logs", "/api/library/documents"):
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.open("/api/instrument/set", method="OPTIONS").status_code, 200)

    def test_login_cookie_status_and_no_plaintext_credentials(self):
        response = self.client.post("/api/auth/login", json={"username": "operator", "password": PASSWORD})
        self.identity = response.json
        cookie = response.headers["Set-Cookie"]
        for attribute in ("HttpOnly", "Secure", "SameSite=Strict", "Path=/api"):
            self.assertIn(attribute, cookie)
        for private in (PASSWORD, self.hashed, "password_hash"):
            self.assertNotIn(private, response.get_data(as_text=True) + cookie)
        status = self.client.get("/api/auth/status").json
        self.assertEqual(status["user"], {"username": "operator", "role": "operator"})
        self.assertEqual(status["sessionId"], self.identity["sessionId"])
        self.assertTrue(status["permissions"]["operateInstrument"])
        self.assertIsInstance(status["expiresAt"], str)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_wrong_password_unknown_user_and_disabled_account_are_generic(self):
        self.users[0]["disabled"] = True
        self.rewrite_users()
        for name, password in (("operator", "wrong"), ("unknown", PASSWORD), ("viewer", PASSWORD)):
            result = self.client.post("/api/auth/login", json={"username": name, "password": password})
            self.assertEqual(result.status_code, 401)
            self.assertEqual(result.json["error"], "Invalid username or password")

    def test_failed_login_rate_limit_and_cooldown(self):
        for _ in range(10):
            self.assertEqual(self.client.post("/api/auth/login", json={"username": "operator", "password": "wrong"}).status_code, 401)
        blocked = self.client.post("/api/auth/login", json={"username": "operator", "password": PASSWORD})
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.headers["Retry-After"], "60")
        self.clock[0] += 61
        self.login()

    def test_parallel_password_checks_are_bounded_and_attempts_reserved(self):
        started, release, counter_lock = Event(), Event(), Lock()
        active, peak = [0], [0]
        def slow_invalid_hash(_hashed, _password):
            with counter_lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
                if active[0] == 4:
                    started.set()
            release.wait(5)
            with counter_lock:
                active[0] -= 1
            return False
        def attempt():
            try:
                self.manager.login("operator", "wrong", "test-ip")
            except LoginRateLimit:
                return "limited"
            except ValueError:
                return "invalid"
        with patch("auth.check_password_hash", side_effect=slow_invalid_hash), ThreadPoolExecutor(max_workers=20) as pool:
            futures = [pool.submit(attempt) for _ in range(20)]
            try:
                self.assertTrue(started.wait(3))
            finally:
                release.set()
            results = [future.result() for future in futures]
        self.assertLessEqual(peak[0], 4)
        self.assertGreaterEqual(results.count("limited"), 10)
        self.assertEqual(len(self.manager.failures[("user", "operator")]), 10)

    def test_password_change_during_hash_does_not_issue_login(self):
        def changed_while_checking(_hashed, _password):
            self.users[2]["role"] = "viewer"
            self.rewrite_users()
            return True
        with patch("auth.check_password_hash", side_effect=changed_while_checking):
            with self.assertRaises(ValueError):
                self.manager.login("operator", PASSWORD, "test-ip")
        self.assertFalse(self.manager.sessions)

    def test_csrf_is_required_for_mutation_and_logout(self):
        self.login()
        for path, body in (("/api/instrument/set", {"path": "trigger.level", "value": 0.5}),
                           ("/api/training/scenarios", {"scenario": "square"}),
                           ("/api/session/log", {"session_id": self.identity["sessionId"], "role": "user", "content": "test"}),
                           ("/api/auth/session", {}), ("/api/auth/logout", {})):
            result = self.post(path, body, {"X-Rhoda-Session": self.identity["sessionId"]})
            self.assertEqual(result.status_code, 403)
            self.assertEqual(result.json["code"], "invalid_csrf")
        self.assertTrue(self.client.get("/api/auth/status").json["authenticated"])

    def test_roles_deny_writes_and_viewer_journal_reads(self):
        for role in ("viewer", "learner", "instructor"):
            self.login(role)
            self.assertTrue(self.client.get("/api/instrument/state").json["ok"])
            for path in ("/api/instrument/set", "/api/instrument/cancel", "/api/training/scenarios", "/api/set"):
                self.assertEqual(self.post(path, {}).status_code, 403)
            if role == "viewer":
                for endpoint in ("logs", "transcript", "progress", "failure-points"):
                    self.assertEqual(self.client.get("/api/session/" + endpoint).status_code, 403)
                self.assertEqual(self.log().status_code, 403)
                self.assertEqual(self.post("/api/auth/session", {}).status_code, 403)
                self.assertIsNone(self.client.get("/api/health").json["session_logs"])

    def test_operator_and_admin_can_preview_and_confirm_simulated_changes(self):
        for role in ("operator", "admin"):
            self.login(role)
            body = {"path": "trigger.level", "value": 0.5}
            preview = self.post("/api/instrument/set", body).json
            self.assertTrue(preview["needsConfirmation"])
            self.assertTrue(self.post("/api/instrument/confirm", {**body, "confirmationId": preview["confirmationId"]}).json["ok"])
            self.assertEqual(self.post("/api/training/scenarios", {"scenario": "square"}).status_code, 200)

    def test_account_owned_journal_and_default_filter(self):
        first = self.login("learner")
        self.assertTrue(self.log("one learner observation").json["ack"])
        other_client = module.app.test_client()
        second = self.login("learner2", other_client)
        self.assertTrue(self.log("another account observation", second, other_client).json["ack"])
        self.assertEqual(self.client.get("/api/session/logs").json["count"], 1)
        self.assertEqual(self.client.get("/api/session/progress").json["total_turns"], 1)
        self.assertNotIn(b"another account", self.client.get("/api/session/transcript").data)
        for endpoint in ("logs", "transcript", "progress", "failure-points"):
            self.assertEqual(self.client.get("/api/session/" + endpoint, query_string={"session_id": second["sessionId"]}).status_code, 403)
        forged = self.post("/api/session/log", {"session_id": second["sessionId"], "role": "user", "content": "forged"})
        self.assertEqual(forged.status_code, 403)
        self.assertEqual(self.post("/api/session/log", {"session_id": "client-chosen-id", "role": "user", "content": "forged"}).status_code, 403)
        self.assertTrue(self.manager.owns("learner", first["sessionId"]))

    def test_server_stamps_owner_and_idempotent_retry(self):
        self.login("learner")
        body = {"event_id": "owned-retry", "session_id": self.identity["sessionId"], "role": "user", "content": "real note", "auth_owner": "admin"}
        self.assertTrue(self.post("/api/session/log", body).json["inserted"])
        self.assertFalse(self.post("/api/session/log", body).json["inserted"])
        self.assertEqual(self.store.snapshot()[0]["auth_owner"], "learner")

    def test_instructor_and_admin_may_inspect_all_but_not_write_other_journals(self):
        learner = self.login("learner")
        self.log()
        self.store.append({"session_id": "anonymous-legacy", "role": "user", "content": "legacy note"})
        for role in ("instructor", "admin"):
            self.login(role)
            self.assertEqual(self.client.get("/api/session/logs").json["count"], 2)
            self.assertEqual(self.client.get("/api/session/logs", query_string={"session_id": learner["sessionId"]}).json["count"], 1)
            self.assertEqual(self.post("/api/session/log", {"session_id": learner["sessionId"], "role": "user", "content": "overwrite"}).status_code, 403)

    def test_new_session_is_server_issued_and_old_owned_records_remain_readable(self):
        old = self.login("learner")
        self.log()
        new = self.post("/api/auth/session", {"sessionId": "chosen"}).json
        self.assertNotEqual(new["sessionId"], old["sessionId"])
        self.assertNotEqual(new["sessionId"], "chosen")
        self.assertTrue(self.manager.owns("learner", new["sessionId"]))
        self.assertEqual(self.client.get("/api/session/logs").json["count"], 0)
        self.assertEqual(self.client.get("/api/session/logs", query_string={"session_id": old["sessionId"]}).json["count"], 1)

    def test_ownership_persists_across_login_and_manager_restart(self):
        old = self.login("learner")
        self.log()
        self.post("/api/auth/logout", {})
        replacement = AuthManager(True, "synthetic-stable-secret-for-tests-0123456789", self.users_path)
        replacement.bind_journal(self.store.path)
        self.manager = replacement
        module.app.extensions["rhoda_auth"] = replacement
        self.login("learner")
        self.assertEqual(self.client.get("/api/session/logs", query_string={"session_id": old["sessionId"]}).json["count"], 1)

    def test_logout_expiry_tampered_cookie_and_new_login_revoke_old_cookie(self):
        self.login()
        original_cookie = self.client.get_cookie(COOKIE_NAME, path="/api").value
        self.assertEqual(self.post("/api/auth/logout", {}).status_code, 200)
        self.client.set_cookie(COOKIE_NAME, original_cookie, path="/api")
        self.assertEqual(self.client.get("/api/instrument/state").status_code, 401)
        self.login()
        old = self.client.get_cookie(COOKIE_NAME, path="/api").value
        self.login()
        self.client.set_cookie(COOKIE_NAME, old, path="/api")
        self.assertFalse(self.client.get("/api/auth/status").json["authenticated"])
        self.client.set_cookie(COOKIE_NAME, "tampered", path="/api")
        self.assertEqual(self.client.get("/api/instrument/state").status_code, 401)
        self.login()
        self.clock[0] += 7201
        self.assertFalse(self.client.get("/api/auth/status").json["authenticated"])
        self.assertEqual(self.client.get("/api/instrument/state").status_code, 401)

    def test_approval_cannot_cross_principal_login_or_learning_session(self):
        self.login()
        body = {"path": "trigger.level", "value": 0.75}
        token = self.post("/api/instrument/set", body).json["confirmationId"]
        previous = self.identity.copy()
        new = self.post("/api/auth/session", {}).json
        self.identity = new
        self.assertFalse(self.post("/api/instrument/confirm", {**body, "confirmationId": token}).json["ok"])
        stale = self.post("/api/instrument/confirm", {**body, "confirmationId": token}, self.headers(previous))
        self.assertEqual(stale.status_code, 403)
        self.assertEqual(stale.json["code"], "session_denied")
        self.assertEqual(self.post("/api/training/scenarios", {"scenario": "square"}, self.headers(previous)).status_code, 403)
        self.assertTrue(self.post("/api/instrument/cancel", {"confirmationId": token}, self.headers(previous)).json["ok"])
        token = self.post("/api/instrument/set", body).json["confirmationId"]
        owned = self.identity["sessionId"]
        self.login()
        result = self.post("/api/instrument/confirm", {**body, "confirmationId": token}, {**self.headers(), "X-Rhoda-Session": owned})
        self.assertFalse(result.json["ok"])
        self.login("admin")
        self.assertEqual(self.post("/api/instrument/set", body, {**self.headers(), "X-Rhoda-Session": owned}).status_code, 403)

    def test_changed_role_password_or_removed_user_revokes_login(self):
        for alteration in ("role", "password", "disabled", "removed"):
            self.users = [{"username": "operator", "role": "operator", "password_hash": self.hashed}, {"username": "admin", "role": "admin", "password_hash": self.hashed}]
            self.rewrite_users()
            self.login()
            if alteration == "role": self.users[0]["role"] = "viewer"
            elif alteration == "password": self.users[0]["password_hash"] = generate_password_hash("new synthetic password", method="scrypt:32768:8:1")
            elif alteration == "disabled": self.users[0]["disabled"] = True
            else: self.users.pop(0)
            self.rewrite_users()
            self.assertEqual(self.client.get("/api/instrument/state").status_code, 401)

    def test_runtime_corrupt_or_missing_config_denies_existing_accounts(self):
        self.login()
        self.users_path.write_text("broken", encoding="utf-8")
        self.assertEqual(self.client.get("/api/instrument/state").status_code, 503)
        self.assertEqual(self.client.get("/api/auth/status").status_code, 503)
        self.assertEqual(self.post("/api/instrument/set", {"path": "trigger.level", "value": 1}).status_code, 503)
        self.users_path.unlink()
        self.assertEqual(self.client.get("/api/instrument/state").status_code, 503)

    def test_origins_rejected_for_login_status_and_authenticated_mutations(self):
        bad = {"Origin": "https://untrusted.example"}
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "operator", "password": PASSWORD}, headers=bad).status_code, 403)
        self.assertEqual(self.client.get("/api/auth/status", headers=bad).status_code, 403)
        self.login()
        self.assertEqual(self.post("/api/instrument/set", {"path": "trigger.level", "value": 1}, {**self.headers(), **bad}).status_code, 403)
        mini = Flask("pilot-cors")
        mini.extensions["rhoda_auth"] = self.manager
        mini.register_blueprint(auth)
        mini.before_request(protect_request)
        CORS(mini, origins=["http://127.0.0.1:8081"], supports_credentials=True)
        response = mini.test_client().get("/api/auth/status", headers={"Origin": "http://127.0.0.1:8081"})
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:8081")
        self.assertEqual(response.headers["Access-Control-Allow-Credentials"], "true")


if __name__ == "__main__":
    unittest.main()
