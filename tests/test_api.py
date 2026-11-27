import tempfile
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from workout.api import create_app


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = create_app(self.temp.name + '/api.sqlite3')
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def command(self, action, payload, revision=None, request_id=None):
        body = {'request_id': request_id or str(uuid4()), 'action': action, 'payload': payload}
        if revision is not None:
            body['expected_revision'] = revision
        return self.client.post('/api/commands', json=body)

    def test_full_lifecycle_api(self):
        started = self.command('start_session', {'title': 'Test'}).json()['result']
        payload = {'session_id': started['id'], 'exercise': 'Squat', 'load': '100', 'unit': 'lb', 'reps': 5}
        rid = str(uuid4())
        first = self.command('log_set', payload, 0, rid)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self.command('log_set', payload, 0, rid).json(), first.json())
        stale = self.command('finish_session', {'session_id': started['id']}, 0)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()['error']['code'], 'revision_conflict')
        done = self.command('finish_session', {'session_id': started['id']}, 1)
        self.assertEqual(done.status_code, 200)
        self.assertEqual(len(self.client.get(f"/api/sessions/{started['id']}/events").json()['events']), 3)
        state = self.client.get('/api/state').json()
        self.assertEqual(state['summary']['total_sets'], 1)
        self.assertEqual(self.client.get('/api/export.json').json()['sessions'][0]['status'], 'finished')
        self.assertIn('45.359237', self.client.get('/api/export.csv').text)

    def test_health_and_security_headers(self):
        result = self.client.get('/api/health')
        self.assertEqual(result.json()['status'], 'ok')
        self.assertIn("frame-ancestors 'none'", result.headers['content-security-policy'])
        self.assertEqual(result.headers['cache-control'], 'no-store')

    def test_cross_origin_writes_rejected(self):
        for origin in ['https://evil.example', 'null', 'http://localhost:4444']:
            result = self.client.post('/api/commands', json={}, headers={'Origin': origin})
            self.assertEqual(result.status_code, 403)
        result = self.client.post('/api/commands', json={}, headers={'Origin': 'http://testserver'})
        self.assertEqual(result.status_code, 422)

    def test_dns_rebinding_host_rejected(self):
        result = self.client.get('/api/state', headers={'Host': 'evil.example'})
        self.assertEqual(result.status_code, 400)

    def test_content_type_and_body_limits(self):
        self.assertEqual(self.client.post('/api/commands', content='{}').status_code, 415)
        self.assertEqual(self.client.post('/api/commands', content=' ' * 70000, headers={'Content-Type': 'application/json'}).status_code, 413)

    def test_chunked_body_limit(self):
        import json
        body = json.dumps({'request_id': str(uuid4()), 'action': 'start_session', 'payload': {'title': 'test'}}).encode()
        response = self.client.post('/api/commands', content=iter([b' ' * 70000, body]), headers={'Content-Type': 'application/json'})
        self.assertEqual(response.status_code, 413)
        self.assertIsNone(self.client.get('/api/state').json()['active_session'])

    def test_strict_command_schema(self):
        self.assertEqual(self.command('start_session', {'title': 'test'}, True).status_code, 422)
        self.assertEqual(self.client.post('/api/commands', json={'request_id': 123}).status_code, 422)

    def test_csv_formula_injection_escaped(self):
        session = self.command('start_session', {'title': '=1+1'}).json()['result']
        self.command('log_set', {'session_id': session['id'], 'exercise': '@evil', 'load': '1', 'unit': 'kg', 'reps': 1}, 0)
        csv = self.client.get('/api/export.csv').text
        self.assertIn("'=1+1", csv)
        self.assertIn("'@evil", csv)


if __name__ == '__main__':
    unittest.main()
