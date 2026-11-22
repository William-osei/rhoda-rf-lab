import tempfile
import unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from session_store import SessionStore


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "sessions.sqlite3"
        self.store = SessionStore(self.path)
        self.event = {
            "event_id": "event-1",
            "session_id": "session-1",
            "role": "user",
            "content": "Test observation",
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_restart_preserves_events(self):
        self.store.append(self.event)
        self.assertEqual(
            list(SessionStore(self.path))[0]["content"], "Test observation"
        )

    def test_retry_deduplicates(self):
        self.assertTrue(self.store.append(self.event))
        self.assertFalse(self.store.append(self.event))
        self.assertEqual(len(self.store), 1)

    def test_conflicting_id_rejected(self):
        self.store.append(self.event)
        with self.assertRaises(ValueError):
            self.store.append({**self.event, "content": "Changed"})

    def test_parallel_retry_one_event(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.store.append(self.event), range(8)))
        self.assertEqual(sum(results), 1)
        self.assertEqual(len(self.store), 1)

    def test_malformed_events_rejected(self):
        for item in (
            [],
            {},
            {**self.event, "content": None},
            {**self.event, "session_id": "bad\nheader"},
            {**self.event, "timestamp": 3},
            {**self.event, "tool_call": []},
        ):
            with self.assertRaises(ValueError):
                self.store.append(item)
        self.assertEqual(len(self.store), 0)

    def test_separate_sessions_retained(self):
        self.store.append(self.event)
        self.store.append(
            {**self.event, "event_id": "event-2", "session_id": "session-2"}
        )
        self.assertEqual(len({e["session_id"] for e in self.store}), 2)
