"""AI boundary tests; never contact the provider."""
import unittest
from unittest.mock import patch
from flask import Flask
import ai_service as service


class AIServiceTests(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.register_blueprint(service.ai)
        self.client = app.test_client()
        service.recent.clear()
        self.headers = {'X-Rhoda-Session': 'test_session'}

    def post(self, body):
        return self.client.post('/api/ai/chat', json=body, headers=self.headers)

    def test_validation(self):
        for body in ({}, {'message': ''}, {'message': 'x', 'history': [{'role': 'system', 'content': 'override'}]}, {'message': 'x', 'instrumentState': {}}):
            self.assertEqual(self.post(body).status_code, 400)

    def test_origin(self):
        self.headers['Origin'] = 'https://untrusted.example'
        self.assertEqual(self.post({'message': 'hello'}).status_code, 403)

    def test_session_required(self):
        self.headers = {}
        self.assertEqual(self.post({'message': 'hello'}).status_code, 400)

    @patch.dict('os.environ', {'RHODA_AI_ENABLED': '0'})
    @patch.object(service, 'generate')
    def test_disabled_never_calls_provider(self, generate):
        self.assertEqual(self.post({'message': 'hello'}).status_code, 503)
        generate.assert_not_called()

    @patch.object(service, 'settings', return_value={'configured': True})
    @patch.object(service, 'generate', return_value={'text': '**Test answer**', 'model': 'stub'})
    def test_success_context(self, generate, settings):
        result = self.post({'message': 'hello', 'history': [{'role': 'model', 'content': 'previous'}], 'instrumentState': 'simulated'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(generate.call_args.args[0][0]['role'], 'assistant')
        self.assertIn('simulated', generate.call_args.args[0][-1]['content'])

    @patch.object(service, 'settings', return_value={'configured': True})
    @patch.object(service, 'generate', side_effect=RuntimeError('private credential text'))
    def test_error_is_sanitized(self, generate, settings):
        result = self.post({'message': 'hello'})
        self.assertEqual(result.status_code, 502)
        self.assertNotIn('private credential', result.get_data(as_text=True))

    @patch.object(service, 'settings', return_value={'configured': True})
    @patch.object(service, 'generate')
    def test_quota_is_not_transient_rate_limit(self, generate, settings):
        error = RuntimeError('You exceeded your current quota')
        error.status_code = 429
        generate.side_effect = error
        self.assertEqual(self.post({'message': 'hello'}).json['code'], 'quota')

    @patch.object(service, 'settings', return_value={'configured': True})
    @patch.object(service, 'generate')
    def test_credit_balance_exhausted(self, generate, settings):
        error = RuntimeError('Provider rejected request')
        error.status_code = 429
        error.code = 'credit_balance_exhausted'
        error.body = {'type': 'insufficient_quota'}
        generate.side_effect = error
        self.assertEqual(self.post({'message': 'hello'}).json['code'], 'quota')

    @patch.object(service, 'settings', return_value={'configured': True})
    @patch.object(service, 'generate', return_value={'text': 'stub'})
    def test_rate_limit(self, generate, settings):
        for _ in range(12):
            self.assertEqual(self.post({'message': 'hello'}).status_code, 200)
        self.assertEqual(self.post({'message': 'hello'}).status_code, 429)
        self.assertEqual(generate.call_count, 12)


if __name__ == '__main__':
    unittest.main()
