"""Failure-boundary regression: temporary journals and fake devices only."""

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import app as module
import library
from instrument.backends import RsInstrumentBackend
from instrument.scope_client import ScopeClient, build_mock_client
from session_store import SessionStore


class DeepApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original = module.scope, module.instrument_mode, module.instrument_error, module.session_logs, module.rag_index
        module.scope, module.instrument_mode, module.instrument_error = build_mock_client(), "mock", None
        module.session_logs = SessionStore(Path(self.temp.name) / "journal.sqlite3")
        module.rag_index = None
        module.app.config["TESTING"] = True
        self.client = module.app.test_client()
        self.headers = {"X-Rhoda-Session": "owner"}

    def tearDown(self):
        module.scope, module.instrument_mode, module.instrument_error, module.session_logs, module.rag_index = self.original
        self.temp.cleanup()

    def post(self, path, body, headers=None):
        return self.client.post(path, json=body, headers=self.headers if headers is None else headers)

    def preview(self):
        return self.post("/api/instrument/set", {"path": "trigger.level", "value": 0.5}).json["confirmationId"]

    def test_cancel_different_session_discloses_failure_and_retains_owner_token(self):
        token = self.preview()
        cancelled = self.post("/api/instrument/cancel", {"confirmationId": token}, {"X-Rhoda-Session": "other"})
        self.assertEqual(cancelled.status_code, 409)
        self.assertFalse(cancelled.json["ok"])
        applied = self.post("/api/instrument/confirm", {"path": "trigger.level", "value": 0.5, "confirmationId": token})
        self.assertTrue(applied.json["ok"])

    def test_cancel_retry_is_idempotent_and_token_cannot_execute(self):
        token = self.preview()
        first = self.post("/api/instrument/cancel", {"confirmationId": token})
        second = self.post("/api/instrument/cancel", {"confirmationId": token})
        self.assertEqual(first.json, {"ok": True, "cancelled": True})
        self.assertEqual(second.json, {"ok": True, "cancelled": False})
        self.assertFalse(self.post("/api/instrument/confirm", {"path": "trigger.level", "value": 0.5, "confirmationId": token}).json["ok"])

    def test_invalid_session_headers_cannot_preview_or_change_scenario(self):
        for sid in (" ", "owner;other", "bad/session", "é", "x" * 129):
            with self.subTest(sid=sid):
                self.assertEqual(self.post("/api/instrument/set", {"path": "trigger.level", "value": 0.5}, {"X-Rhoda-Session": sid}).status_code, 400)
                self.assertEqual(self.post("/api/training/scenarios", {"scenario": "square"}, {"X-Rhoda-Session": sid}).status_code, 400)
        self.assertEqual(module.scope.read_state().result["training_scenario"], "sine")

    def test_session_query_validation_prevents_invalid_transcript_filename(self):
        for endpoint in ("logs", "transcript", "progress", "failure-points"):
            for sid in ("", "bad\nheader", "../other", 'bad"filename'):
                with self.subTest(endpoint=endpoint, sid=sid):
                    response = self.client.get("/api/session/" + endpoint, query_string={"session_id": sid})
                    self.assertEqual(response.status_code, 400)
                    self.assertIsNotNone(response.json)

    def test_failure_points_and_other_views_share_session_filter(self):
        for sid, count in (("owner", 1), ("other", 2)):
            for i in range(count):
                module.session_logs.append({"event_id": f"{sid}-{i}", "session_id": sid, "role": "system", "content": "error: faulty trigger", "confirmed": False, "topic": "troubleshooting"})
        summary = self.client.get("/api/session/failure-points?session_id=owner").json
        self.assertEqual((summary["total_errors"], summary["total_faults"], summary["total_denied_actions"]), (1, 1, 1))
        self.assertTrue(all(e["session_id"] == "owner" for e in summary["recent_errors"]))
        self.assertEqual(self.client.get("/api/session/logs?session_id=owner").json["count"], 1)
        self.assertEqual(self.client.get("/api/session/progress?session_id=owner").json["total_turns"], 1)
        self.assertEqual(self.client.get("/api/session/failure-points").json["total_errors"], 3)

    def test_untrusted_browser_origin_cannot_read_journal_or_mutate_scope(self):
        headers = {**self.headers, "Origin": "https://untrusted.example"}
        self.assertEqual(self.post("/api/instrument/set", {"path": "trigger.level", "value": 0.5}, headers).status_code, 403)
        self.assertEqual(self.client.get("/api/session/logs", headers=headers).status_code, 403)
        self.assertEqual(self.client.open("/api/instrument/set", method="OPTIONS", headers=headers).status_code, 403)
        self.assertEqual(module.scope.read_state().result["trigger"]["level"], 0.0)

    def test_configured_origin_whitespace_and_cors_preflight(self):
        with patch.dict("os.environ", {"RHODA_ALLOWED_ORIGINS": " http://127.0.0.1:8081 , https://lab.example "}):
            self.assertTrue(self.post("/api/instrument/set", {"path": "trigger.level", "value": 0.5}, {**self.headers, "Origin": "https://lab.example"}).json["ok"])
        result = self.client.open("/api/instrument/set", method="OPTIONS", headers={"Origin": "http://127.0.0.1:8081", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type,X-Rhoda-Session"})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:8081")

    def test_large_instrument_and_journal_requests_return_json_without_writes(self):
        oversized = self.post("/api/instrument/set", {"path": "trigger.level", "value": 0.5, "padding": "x" * 17000})
        self.assertEqual(oversized.status_code, 413)
        self.assertFalse(oversized.json["ok"])
        response = self.post("/api/session/log", {"content": "x" * 512001})
        self.assertEqual(response.status_code, 413)
        self.assertFalse(response.json["ack"])
        self.assertEqual(len(module.session_logs), 0)

    def test_retrieval_validation_applies_without_optional_model(self):
        for body in ([], {}, {"query": " "}, {"query": "trigger", "top_k": True}, {"query": "trigger", "top_k": -1}, {"query": "trigger", "top_k": "3"}, {"query": "trigger", "top_k": 11}, {"query": "trigger", "category": "unknown"}):
            with self.subTest(body=body):
                self.assertEqual(self.post("/api/rag/retrieve", body).status_code, 400)
        self.assertFalse(self.post("/api/rag/retrieve", {"query": "trigger"}).json["available"])

    def test_retrieval_all_category_and_failure_disclosure(self):
        class FakeIndex:
            def retrieve(self, **arguments):
                self.arguments = arguments
                return {"chunks": []}
        module.rag_index = index = FakeIndex()
        result = self.post("/api/rag/retrieve", {"query": " trigger ", "top_k": 2, "category": "all"})
        self.assertTrue(result.json["available"])
        self.assertEqual(index.arguments, {"query": "trigger", "top_k": 2, "category": None})
        with patch.object(index, "retrieve", side_effect=RuntimeError("private implementation detail")):
            failure = self.post("/api/rag/retrieve", {"query": "trigger"})
        self.assertEqual(failure.status_code, 503)
        self.assertNotIn("private implementation", failure.get_data(as_text=True))

    def test_unknown_read_scope_is_not_mislabeled_full_state(self):
        result = self.client.get("/api/instrument/state?scope=unknown").json
        self.assertFalse(result["ok"])
        self.assertIsNone(result["result"])

    def test_library_page_and_file_disclose_catalogue_failure_as_json(self):
        for error in (OSError("missing root"), KeyError("invalid entry"), ValueError("corrupt catalogue")):
            with patch.object(library, "data", side_effect=error):
                for endpoint in ("documents", "search?q=trigger", "page/document/1", "file/document"):
                    response = self.client.get("/api/library/" + endpoint)
                    self.assertEqual(response.status_code, 503)
                    self.assertIn("error", response.json)


class ReadbackTransport:
    def __init__(self, overrides=None):
        self.overrides = overrides or {}
        self.commands = []

    def query_str(self, cmd):
        if cmd in self.overrides:
            return self.overrides[cmd]
        if cmd == "*IDN?":
            return "Rohde&Schwarz,RTB24,TEST,03.000"
        if cmd == "ACQuire:STATe?":
            return "RUN"
        if cmd.endswith(":COUPling?"):
            return "DCL"
        if cmd == "TRIGger:A:MODE?":
            return "AUTO"
        if cmd == "TRIGger:A:EDGE:SLOPe?":
            return "POS"
        if cmd == "TRIGger:A:SOURce?":
            return "CH1"
        return "1"

    def write_str(self, cmd):
        self.commands.append(cmd)


class ReadbackBoundaryTests(unittest.TestCase):
    def test_nonfinite_or_sentinel_state_is_failed_not_exportable_json(self):
        for raw in ("NaN", "INF", "-INF", "9.9E37", ""):
            transport = ReadbackTransport({"TIMebase:SCALe?": raw})
            client = ScopeClient(RsInstrumentBackend(transport))
            with self.subTest(raw=raw):
                state = client.read_state()
                self.assertFalse(state.ok)
                self.assertIsNone(state.result)
                preview = client.set_parameter("trigger.level", 0.5)
                self.assertFalse(preview.ok)
                self.assertIsNone(preview.confirmationId)
                self.assertEqual(transport.commands, [])

    def test_unknown_enabled_state_is_not_silently_disabled(self):
        client = ScopeClient(RsInstrumentBackend(ReadbackTransport({"CHANnel2:STATe?": "unavailable"})))
        state = client.read_state("channel")
        self.assertFalse(state.ok)
        self.assertIn("channel 2 state", state.error)

    def test_unknown_enums_are_not_reported_as_normalized_state(self):
        for query in ("TRIGger:A:MODE?", "TRIGger:A:EDGE:SLOPe?", "CHANnel1:COUPling?"):
            with self.subTest(query=query):
                self.assertFalse(ScopeClient(RsInstrumentBackend(ReadbackTransport({query: "BAD"}))).read_state().ok)

    def test_noninteger_record_length_is_not_truncated(self):
        client = ScopeClient(RsInstrumentBackend(ReadbackTransport({"ACQuire:POINts?": "1000.5"})))
        self.assertFalse(client.read_state("acquisition").ok)

    def test_measurement_no_signal_sentinels_remain_explicit(self):
        for raw in ("NaN", "INF", "-INF", "9.9E37"):
            with self.subTest(raw=raw):
                backend = RsInstrumentBackend(ReadbackTransport({"MEASurement1:RESult:ACTual?": raw}))
                result = backend.run_measurement("frequency", "CH1")
                self.assertIsNone(result["value"])
                self.assertEqual(result["status"], "no_signal")

    def test_cancel_and_confirm_race_cannot_apply_after_successful_cancel(self):
        for _ in range(20):
            client = build_mock_client()
            token = client.set_parameter("trigger.level", 0.5).confirmationId
            with ThreadPoolExecutor(max_workers=2) as pool:
                cancel = pool.submit(client.cancel, token)
                confirm = pool.submit(client.set_parameter, "trigger.level", 0.5, True, token)
                was_cancelled, was_applied = cancel.result(), confirm.result().ok
            self.assertNotEqual(was_cancelled, was_applied)
            self.assertEqual(client.read_state().result["trigger"]["level"], 0.5 if was_applied else 0.0)


class SnapshotTests(unittest.TestCase):
    def test_snapshot_filters_orders_and_does_not_mutate_journal(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SessionStore(Path(temporary) / "events.sqlite3")
            for sid in ("a", "b", "a"):
                store.append({"session_id": sid, "role": "user", "content": sid})
            snapshot = store.snapshot("a")
            self.assertEqual([event["session_id"] for event in snapshot], ["a", "a"])
            snapshot[0]["content"] = "changed"
            self.assertEqual(store.snapshot("a")[0]["content"], "a")
            self.assertEqual(len(store.snapshot()), 3)
            with self.assertRaises(ValueError):
                store.snapshot("a\n")

    def test_invalid_confirmation_and_topic_cannot_corrupt_summaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = SessionStore(Path(temporary) / "events.sqlite3")
            base = {"session_id": "a", "role": "user", "content": "trigger"}
            for extra in ({"confirmed": "false"}, {"confirmed": 0}, {"topic": []}, {"topic": "x" * 129}):
                with self.assertRaises(ValueError):
                    store.append({**base, **extra})
            self.assertEqual(len(store), 0)


if __name__ == "__main__":
    unittest.main()
