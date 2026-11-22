"""Session attribution survives instructor downloads, including tools and legacy records."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app as module
from session_store import SessionStore


class TranscriptExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        store = SessionStore(Path(self.temporary.name) / 'journal.sqlite3')
        for event in [
            dict(session_id='alpha', role='user', content='Probe compensation', auth_owner='learner-a'),
            dict(session_id='beta', role='assistant', content='Trigger lesson', auth_owner='learner-b'),
            dict(session_id='legacy', role='tool', content='', tool_call=dict(name='measure', category='READ'), confirmed=True),
        ]:
            store.append(event)
        journal = patch.object(module, 'session_logs', store)
        journal.start()
        self.addCleanup(journal.stop)

    def export(self, session_id=None):
        query = {} if session_id is None else {'session_id': session_id}
        # Exercise formatting/filtering with a request context without changing lab access configuration.
        with module.app.test_request_context('/api/session/transcript', query_string=query):
            return module.export_transcript().get_data(as_text=True)

    def test_combined_download_identifies_each_session_and_owner(self):
        text = self.export()
        self.assertIn('[session: alpha; owner: "learner-a"] USER: Probe compensation', text)
        self.assertIn('[session: beta; owner: "learner-b"] ASSISTANT: Trigger lesson', text)

    def test_selected_download_excludes_other_session_content(self):
        text = self.export('alpha')
        self.assertIn('Probe compensation', text)
        self.assertNotIn('beta', text)
        self.assertNotIn('Trigger lesson', text)
        self.assertEqual(self.export('empty'), '')

    def test_legacy_tool_export_does_not_invent_an_owner(self):
        self.assertIn('[session: legacy; owner: "Offline / owner unavailable"] TOOL: measure (READ) confirmed=True', self.export('legacy'))


if __name__ == '__main__':
    unittest.main()
