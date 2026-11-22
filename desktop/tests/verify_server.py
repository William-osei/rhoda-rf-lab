"""Bounded, real loopback HTTP regression tests for the offline desktop host.

Each subprocess uses copied backend sources and a temporary fixture library,
build and journal. No shared service, microphone, provider or device is used.
"""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest


PROJECT = Path(__file__).resolve().parents[2]
SERVER = PROJECT / "desktop" / "server.py"
ENTRY_PAGES = ("desktop.html", "index.html", "chat.html", "library.html", "practice.html", "spatial-bench.html", "instruments.html", "instructor.html")


def free_port():
    with socket.socket() as listener:
        try:
            listener.bind(("127.0.0.1", 8766))
        except OSError:
            listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


class LocalService:
    def __init__(self, project, resources, data, token, extra_env=None):
        self.port = free_port()
        self.origin = f"http://127.0.0.1:{self.port}"
        self.token = token
        self.data = data
        self.log = data.parent / ("service-" + data.name + ".log")
        env = dict(os.environ)
        for name in list(env):
            if name.startswith("RHODA_AUTH_"):
                env.pop(name)
        env.update({"PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1", "RHODA_DESKTOP_TOKEN": token,
                    "RHODA_SESSION_DB": str(project / "old-journal.sqlite3"), "RHODA_AI_ENABLED": "1", "RHODA_RAG_ENABLED": "1",
                    "SCOPE_RESOURCE": "fixture-blocked-before-instrument-import", "SCOPE_SIMULATE": "1",
                    "RHODA_ALLOWED_ORIGINS": "https://fixture.invalid", "OPENAI_API_KEY": "fixture-never-used"})
        if extra_env:
            env.update(extra_env)
        self.output = self.log.open("wb")
        self.process = subprocess.Popen([sys.executable, "-B", str(SERVER), "--project-root", str(project), "--resource-root", str(resources),
                                         "--data-dir", str(data), "--port", str(self.port)],
                                        # Intentionally not project: relative auth config must still work.
                                        cwd=data.parent, env=env, stdout=self.output, stderr=subprocess.STDOUT)

    def request(self, method, path, body=None, headers=None):
        headers = dict(headers or {})
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
            headers.setdefault("Content-Type", "application/json")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            payload = response.read()
            result = (response.status, dict(response.getheaders()), payload)
            return result
        finally:
            connection.close()

    def json(self, method, path, body=None, headers=None):
        status, response_headers, payload = self.request(method, path, body, headers)
        return status, response_headers, json.loads(payload)

    def wait_ready(self):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise AssertionError("Fixture service exited before readiness:\n" + self.log.read_text(encoding="utf-8"))
            try:
                status, _, result = self.json("GET", "/_desktop/ready", headers={"X-Rhoda-Desktop-Token": self.token})
                if status == 200 and result["ready"]:
                    return result
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(.1)
        raise AssertionError("Fixture service was not ready within 12 seconds")

    def close(self):
        if self.process.poll() is None:
            try:
                self.request("POST", "/_desktop/shutdown", headers={"X-Rhoda-Desktop-Token": self.token})
                self.process.wait(timeout=4)
            except (OSError, http.client.HTTPException, subprocess.TimeoutExpired):
                # Only this test's owned process can be terminated on failure.
                self.process.terminate()
                self.process.wait(timeout=4)
        self.output.close()


@contextmanager
def running(project, resources, data, token, extra_env=None):
    service = LocalService(project, resources, data, token, extra_env)
    try:
        service.wait_ready()
        yield service
    finally:
        service.close()


class DesktopServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = Path(tempfile.mkdtemp(prefix="rhoda-desktop-tests-")).resolve()
        cls.project = cls.fixture / "project"
        cls.resources = cls.fixture / "resources"
        cls.project.mkdir()
        shutil.copytree(PROJECT / "server", cls.project / "server", ignore=shutil.ignore_patterns("data", "__pycache__", "test*"))
        # Fail before any device/provider import if a desktop safety override
        # regresses; this makes the intentionally conflicting fixture safe.
        backend = cls.project / "server" / "app.py"
        safety_assertion = '''import os as _desktop_test_os
for _name, _expected in {"SCOPE_RESOURCE":"", "SCOPE_SIMULATE":"0", "RHODA_AI_ENABLED":"0", "RHODA_RAG_ENABLED":"1"}.items():
    if _desktop_test_os.environ.get(_name) != _expected:
        raise RuntimeError("Desktop safety override failed before any device or provider import")
'''
        backend.write_text(safety_assertion + backend.read_text(encoding="utf-8"), encoding="utf-8")
        # Detect optional model/provider imports without any external call.
        for name in ("openai.py", "sentence_transformers.py"):
            (cls.project / "server" / name).write_text("raise RuntimeError('Optional external provider/model import forbidden by fixture')\n", encoding="utf-8")
        static = cls.project / "dist"
        static.mkdir()
        for page in ENTRY_PAGES:
            (static / page).write_text("<!doctype html><title>" + page + "</title><p>Offline built fixture</p>", encoding="utf-8")
        for directory in ("assets", "gltf", "learning", "audio", "fonts", "ui"):
            (static / directory).mkdir()
        (static / "assets" / "fixture.js").write_text("console.log('local fixture')", encoding="utf-8")
        (static / "assets" / "fixture.js.map").write_text("private map", encoding="utf-8")
        (static / "gltf" / "fixture.glb").write_bytes(b"glTF-local-model")
        (static / "learning" / "signal_ml_starter.py").write_text("# Downloadable learning example\n", encoding="utf-8")
        (static / "learning" / "vna").mkdir()
        (static / "learning" / "vna" / "index.html").write_text("<!doctype html><title>VNA teaching fixture</title>", encoding="utf-8")
        (static / "learning" / "private.py").write_text("# not a public application asset\n", encoding="utf-8")
        (static / ".env").write_text("PRIVATE=never-expose", encoding="utf-8")
        (static / "assets" / ".secret.json").write_text('{"secret":"never-expose"}', encoding="utf-8")
        (static / "performance-build-report.json").write_text("{}", encoding="utf-8")
        (cls.project / "server" / "static").mkdir()
        (cls.project / "server" / "static" / "secret.txt").write_text("must not leak Flask default static", encoding="utf-8")
        catalogue = cls.resources / "00-START-HERE" / "catalog"
        catalogue.mkdir(parents=True)
        text = cls.resources / "00-START-HERE" / "extracted" / "fixture.txt"
        text.parent.mkdir()
        text.write_text("--- PAGE 1 ---\nAn oscilloscope displays voltage over time. Probe compensation and trigger alignment matter.\n", encoding="utf-8")
        pdf = cls.resources / "RHODES AND SCHWARZE" / "Fixture" / "Manuals" / "offline.pdf"
        pdf.parent.mkdir(parents=True)
        pdf.write_bytes(b"%PDF-1.4\n%local fixture only\n%%EOF\n")
        cls.document_id = hashlib.sha256(pdf.read_bytes()).hexdigest()[:20]
        (catalogue / "documents.json").write_text(json.dumps([{"path":pdf.relative_to(cls.resources).as_posix(), "extracted_text":text.relative_to(cls.resources).as_posix(),
                                                              "title":"Offline scope fixture", "sha256":hashlib.sha256(pdf.read_bytes()).hexdigest()}]), encoding="utf-8")
        with sqlite3.connect(cls.project / "old-journal.sqlite3") as db:
            db.execute("CREATE TABLE original_marker (value TEXT)")
            db.execute("INSERT INTO original_marker VALUES ('preserve original journal')")
        cls.old_journal_hash = hashlib.sha256((cls.project / "old-journal.sqlite3").read_bytes()).hexdigest()
        cls.token = secrets.token_hex(32)
        cls.service = LocalService(cls.project, cls.resources, cls.fixture / "offline-data", cls.token)
        cls.ready = cls.service.wait_ready()

    @classmethod
    def tearDownClass(cls):
        cls.service.close()
        # Delete only the positively identified external temporary fixture.
        path = cls.fixture.resolve()
        if path.parent != Path(tempfile.gettempdir()).resolve() or not path.name.startswith("rhoda-desktop-tests-"):
            raise AssertionError("Refusing cleanup outside the owned temporary test fixture")
        shutil.rmtree(path)

    def test_01_supervisor_identity_and_no_secret_leak(self):
        self.assertEqual(self.ready["app"], "rhoda-desktop")
        self.assertEqual(self.ready["mode"], "mock")
        self.assertEqual(self.ready["port"], self.service.port)
        # On Windows the venv executable can bootstrap a second interpreter;
        # readiness identifies that actual service, not the bootstrap wrapper.
        self.assertIsInstance(self.ready["pid"], int)
        self.assertGreater(self.ready["pid"], 0)
        self.assertIsNone(self.service.process.poll())
        self.assertEqual(self.ready["entryPages"], len(ENTRY_PAGES))
        self.assertEqual(len(self.ready["projectId"]), 20)
        self.assertNotIn(self.token, json.dumps(self.ready))
        self.assertNotIn(self.token, self.service.log.read_text(encoding="utf-8"))

    def test_02_host_origin_nonce_guards(self):
        for headers in ({}, {"X-Rhoda-Desktop-Token":"wrong"}, {"X-Rhoda-Desktop-Token":self.token,"Host":"localhost:" + str(self.service.port)},
                        {"X-Rhoda-Desktop-Token":self.token,"Origin":"https://outside.invalid"}):
            with self.subTest(headers=list(headers)):
                self.assertEqual(self.service.request("GET", "/_desktop/ready", headers=headers)[0], 403)
        self.assertEqual(self.service.request("GET", "/_desktop/ready?token=" + self.token)[0], 403)
        self.assertEqual(self.service.request("POST", "/_desktop/shutdown", headers={"X-Rhoda-Desktop-Token":self.token, "Origin":"null"})[0], 403)
        self.assertEqual(self.service.request("POST", "/_desktop/shutdown")[0], 403)
        self.assertEqual(self.service.request("GET", "/_desktop/exit-requested")[0], 403)
        self.assertIsNone(self.service.process.poll())
        status, _, ready = self.service.json("GET", "/_desktop/ready", headers={"X-Rhoda-Desktop-Token":self.token, "Origin":self.service.origin})
        self.assertEqual(status, 200)
        self.assertTrue(ready["ready"])

    def test_03_entry_pages_assets_range_and_offline_csp(self):
        for path in ("/", *("/" + page for page in ENTRY_PAGES), "/assets/fixture.js", "/gltf/fixture.glb", "/learning/signal_ml_starter.py", "/learning/vna/index.html?page=instrument&embedded=1"):
            with self.subTest(path=path):
                status, headers, _ = self.service.request("GET", path)
                self.assertEqual(status, 200)
                self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(headers["Content-Security-Policy"], "connect-src 'self' blob:")
                if path == "/" or path.split("?", 1)[0].endswith(".html"):
                    self.assertEqual(headers["Cache-Control"], "no-store")
        desktop_source = (PROJECT / "desktop.html").read_text(encoding="utf-8-sig")
        self.assertIn('id="exit-rhoda"', desktop_source)
        self.assertIn('id="exit-rhoda-status"', desktop_source)
        status, _, body = self.service.request("HEAD", "/chat.html")
        self.assertEqual((status, body), (200, b""))
        status, headers, body = self.service.request("GET", "/gltf/fixture.glb", headers={"Range":"bytes=0-3"})
        self.assertEqual((status, body), (206, b"glTF"))
        self.assertTrue(headers["Content-Range"].startswith("bytes 0-3/"))

    def test_04_only_dist_public_allowlist(self):
        for path in ("/.env", "/assets/.secret.json", "/assets/fixture.js.map", "/learning/private.py", "/src/index.ts", "/server/app.py",
                     "/static/secret.txt", "/performance-build-report.json", "/api/not-a-real-route", "/api", "/../server/app.py", "/%2e%2e/server/app.py", "/assets/%5c..%5c.env"):
            with self.subTest(path=path):
                status, _, body = self.service.request("GET", path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"never-expose", body)
                self.assertNotIn(b"Offline built fixture", body)
        self.assertEqual(self.service.request("POST", "/chat.html", body={})[0], 405)

    def test_05_existing_api_stays_offline_and_origin_checked(self):
        status, headers, health = self.service.json("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["instrument"], "mock")
        self.assertEqual(health["rag"], "15 docs")
        self.assertEqual(headers["Content-Security-Policy"], "connect-src 'self' blob:")
        self.assertEqual(self.service.json("GET", "/api/auth/status")[2]["enabled"], False)
        self.assertEqual(self.service.json("GET", "/api/ai/status")[2]["configured"], False)
        self.assertEqual(self.service.request("POST", "/api/ai/chat", body={"message":"Fixture request that must not reach a provider"}, headers={"X-Rhoda-Session":"desktop-fixture"})[0], 503)
        rag_status, _, rag = self.service.json("GET", "/api/rag/status")
        self.assertEqual(rag_status, 200)
        self.assertEqual(rag["available"], True)
        self.assertEqual(rag["method"], "lexical")
        retrieval_status, _, retrieval = self.service.json(
            "POST",
            "/api/rag/retrieve",
            body={"query": "probe compensation", "category": "procedure", "top_k": 1},
        )
        self.assertEqual(retrieval_status, 200)
        self.assertTrue(retrieval["available"])
        self.assertEqual(retrieval["method"], "lexical")
        self.assertEqual(len(retrieval["chunks"]), 1)
        self.assertEqual(retrieval["chunks"][0]["category"], "procedure")
        self.assertIn("probe compensation", retrieval["chunks"][0]["text"].lower())
        self.assertEqual(retrieval["chunks"][0]["source"], "probe_compensation")
        self.assertEqual(self.service.request("GET", "/api/health", headers={"Origin":"https://outside.invalid"})[0], 403)
        self.assertEqual(self.service.request("GET", "/api/health", headers={"Origin":self.service.origin})[0], 200)
        self.assertEqual(self.service.json("GET", "/api/instrument/discover")[2], {"resources":[], "count":0})

    def test_05b_mock_changes_still_require_exact_confirmation(self):
        credentials = {"X-Rhoda-Session":"desktop-confirmation", "Origin":self.service.origin}
        operation = {"path":"channel.1.vertical_scale", "value":2.0}
        status, _, pending = self.service.json("POST", "/api/instrument/set", body=operation, headers=credentials)
        self.assertEqual(status, 200)
        self.assertTrue(pending["needsConfirmation"])
        self.assertTrue(pending["confirmationId"])
        status, _, approved = self.service.json("POST", "/api/instrument/confirm", body={**operation,"confirmationId":pending["confirmationId"]}, headers=credentials)
        self.assertEqual(status, 200)
        self.assertTrue(approved["ok"])
        self.assertFalse(approved["needsConfirmation"])
        repeated = self.service.json("POST", "/api/instrument/confirm", body={**operation,"confirmationId":pending["confirmationId"]}, headers=credentials)[2]
        self.assertFalse(repeated["ok"])

    def test_06_fixture_library_search_and_original_file(self):
        status, _, listing = self.service.json("GET", "/api/library/documents")
        self.assertEqual(status, 200)
        self.assertTrue(listing["offline"])
        self.assertEqual(listing["indexed_pages"], 1)
        self.assertEqual(listing["documents"][0]["id"], self.document_id)
        self.assertEqual(self.service.json("GET", "/api/library/search?q=probe")[2]["results"][0]["id"], self.document_id)
        self.assertIn("voltage over time", self.service.json("GET", "/api/library/page/" + self.document_id + "/1")[2]["text"])
        self.assertEqual(self.service.request("GET", "/api/library/file/" + self.document_id, headers={"Range":"bytes=0-3"})[2], b"%PDF")

    def test_07_separate_persistent_desktop_journal(self):
        event = {"event_id":"desktop-fixture-event", "session_id":"desktop-fixture", "role":"user", "content":"Offline desktop evidence"}
        self.assertEqual(self.service.request("POST", "/api/session/log", body=event)[0], 200)
        database = self.fixture / "offline-data" / "sessions.sqlite3"
        with sqlite3.connect(database) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM events WHERE event_id='desktop-fixture-event'").fetchone()[0], 1)
        self.assertEqual(hashlib.sha256((self.project / "old-journal.sqlite3").read_bytes()).hexdigest(), self.old_journal_hash)

    def test_08_auth_dotenv_preserved_cookies_csrf_and_shutdown(self):
        from werkzeug.security import generate_password_hash
        auth_project = self.fixture / "auth-project"
        shutil.copytree(self.project, auth_project)
        (auth_project / "accounts.json").write_text(json.dumps({"users":[{"username":"fixture-learner", "password_hash":generate_password_hash("fixture-only-password", method="scrypt:32768:8:1"), "role":"learner"}]}), encoding="utf-8")
        # This is fixture-only configuration, not a stored real credential.
        (auth_project / ".env").write_text("RHODA_AUTH_ENABLED=1\nRHODA_AUTH_SECRET=fixture-stable-secret-000000000000000000000000000000\nRHODA_AUTH_USERS_FILE=accounts.json\nRHODA_AUTH_COOKIE_SECURE=0\nRHODA_AI_ENABLED=1\nSCOPE_RESOURCE=fixture-blocked-before-instrument-import\n", encoding="utf-8")
        token = secrets.token_hex(32)
        with running(auth_project, self.resources, self.fixture / "auth-data", token) as auth_service:
            # The window-exit action stays usable without an account, but only
            # a same-origin JSON request can raise the supervisor signal.
            exit_headers = {"X-Rhoda-Desktop-Token":token}
            self.assertEqual(auth_service.json("GET", "/_desktop/exit-requested", headers=exit_headers)[2]["requested"], False)
            self.assertEqual(auth_service.request("GET", "/_desktop/exit-requested")[0], 403)
            self.assertEqual(auth_service.request("POST", "/api/desktop/exit", body={}, headers={})[0], 403)
            self.assertEqual(auth_service.request("POST", "/api/desktop/exit", body={}, headers={"Origin":"https://outside.invalid"})[0], 403)
            self.assertEqual(auth_service.request("POST", "/api/desktop/exit", body=b"exit", headers={"Origin":auth_service.origin, "Content-Type":"text/plain"})[0], 415)
            self.assertEqual(auth_service.request("POST", "/api/desktop/exit", body={}, headers={"Origin":auth_service.origin})[0], 202)
            self.assertEqual(auth_service.json("GET", "/_desktop/exit-requested", headers=exit_headers)[2]["requested"], True)
            self.assertEqual(auth_service.json("GET", "/api/auth/status")[2]["enabled"], True)
            self.assertEqual(auth_service.request("GET", "/api/health")[0], 401)
            self.assertEqual(auth_service.request("GET", "/desktop.html")[0], 200)
            status, headers, login = auth_service.json("POST", "/api/auth/login", body={"username":"fixture-learner", "password":"fixture-only-password"}, headers={"Origin":auth_service.origin})
            self.assertEqual(status, 200)
            cookie = headers["Set-Cookie"]
            self.assertIn("HttpOnly", cookie)
            self.assertIn("SameSite=Strict", cookie)
            self.assertIn("Path=/api", cookie)
            credentials = {"Cookie":cookie.split(";", 1)[0], "Origin":auth_service.origin}
            self.assertEqual(auth_service.request("GET", "/api/health", headers=credentials)[0], 200)
            self.assertEqual(auth_service.request("POST", "/api/auth/logout", headers=credentials)[0], 403)
            credentials["X-Rhoda-CSRF"] = login["csrfToken"]
            self.assertEqual(auth_service.request("POST", "/api/auth/logout", headers=credentials)[0], 200)
            # Supervisor readiness/shutdown remain independent of API login.
            self.assertEqual(auth_service.request("POST", "/_desktop/shutdown", headers={"X-Rhoda-Desktop-Token":token, "Origin":auth_service.origin})[0], 202)
            auth_service.process.wait(timeout=4)
            self.assertEqual(auth_service.process.returncode, 0)

    def test_09_startup_fails_closed_without_build_nonce_or_auth_config(self):
        incomplete = self.fixture / "incomplete"
        shutil.copytree(self.project, incomplete)
        (incomplete / "dist" / "desktop.html").unlink()
        cases = [(incomplete, self.token, None, "desktop.html"),
                 (self.project, "invalid", None, "supervisor nonce"),
                 (self.project, self.token, {"RHODA_AUTH_ENABLED":"1", "RHODA_AUTH_SECRET":"too-short"}, "RHODA_AUTH_SECRET")]
        for index, (project, token, env, explanation) in enumerate(cases):
            service = LocalService(project, self.resources, self.fixture / ("rejected-" + str(index)), token, env)
            try:
                service.process.wait(timeout=8)
                self.assertNotEqual(service.process.returncode, 0)
                self.assertIn(explanation, service.log.read_text(encoding="utf-8"))
                self.assertNotIn(token, service.log.read_text(encoding="utf-8"))
            finally:
                service.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
