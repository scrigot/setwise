import concurrent.futures
import copy
import tempfile
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from workout.api import create_app
from workout.store import DomainError, Store


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(self.temp.name + '/import.sqlite3')
        self.payload = {'title': 'Historical workout', 'started_at': '2026-10-18T13:58:28-04:00',
                        'finished_at': '2026-10-18T14:25:11-04:00',
                        'source': {'system': 'Hevy', 'id': 'synthetic-source'},
                        'notes': 'Exercise name confirmed by user.',
                        'sets': [{'exercise': 'Barbell Bench Press', 'load': '225', 'unit': 'lb', 'reps': 1,
                                  'rpe': 9, 'rpe_source': 'User estimate; source RPE null'},
                                 {'exercise': 'Feet-Up Barbell Bench Press', 'load': '135', 'unit': 'lb', 'reps': 10}]}

    def tearDown(self):
        self.temp.cleanup()

    def run_import(self, payload=None, request_id=None):
        return self.store.command(request_id or str(uuid4()), 'import_session', payload or self.payload)

    def test_preserves_times_units_provenance_and_active_session(self):
        active = self.store.command(str(uuid4()), 'start_session', {'title': 'In progress'})['result']
        imported = self.run_import()['result']
        state = Store(self.store.path).state()
        self.assertEqual(state['active_session'], active)
        self.assertEqual(imported['started_at'], '2026-10-18T17:58:28+00:00')
        self.assertEqual(imported['finished_at'], '2026-10-18T18:25:11+00:00')
        self.assertEqual(imported['status'], 'finished')
        self.assertEqual(imported['sets'][0]['load'], '225')
        self.assertEqual(imported['sets'][0]['load_kg'], '102.05828325')
        self.assertEqual(imported['sets'][0]['rpe_source'], 'User estimate; source RPE null')
        self.assertIsNone(imported['sets'][1]['rpe'])
        self.assertEqual(len(state['summary']['exercises']), 2)
        self.assertEqual(self.store.events(imported['id'])[0]['after']['source'], imported['source'])

    def test_retry_and_duplicate_source_protection(self):
        rid = str(uuid4())
        first = self.run_import(request_id=rid)
        self.assertEqual(first, self.run_import(request_id=rid))
        with self.assertRaises(DomainError) as ctx:
            self.run_import()
        self.assertEqual(ctx.exception.code, 'duplicate_source')
        self.assertEqual(len(self.store.state()['sessions']), 1)

    def test_concurrent_source_import_creates_one_session(self):
        def attempt(_):
            try:
                self.run_import()
                return 'saved'
            except DomainError as error:
                return error.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(attempt, range(4)))
        self.assertEqual(results.count('saved'), 1)
        self.assertEqual(results.count('duplicate_source'), 3)

    def test_invalid_import_rolls_back_everything(self):
        for change in [{'started_at': '2026-10-18T17:58:28'}, {'finished_at': '2026-10-17T00:00:00Z'},
                       {'sets': []}, {'sets': self.payload['sets'] + [{'exercise': 'Bad', 'unit': 'lb', 'load': 5, 'reps': 0}]}]:
            payload = copy.deepcopy(self.payload)
            payload.update(change)
            with self.assertRaises(DomainError):
                self.run_import(payload)
            self.assertEqual(self.store.export()['sessions'], [])
            self.assertEqual(self.store.export()['events'], [])

    def test_history_orders_by_workout_not_import_time(self):
        recent = self.run_import()['result']
        older = copy.deepcopy(self.payload)
        older.update(started_at='2026-10-17T00:00:00Z', finished_at='2026-10-17T01:00:00Z')
        older['source']['id'] = 'older-source'
        self.run_import(older)
        self.assertEqual(self.store.state()['sessions'][0]['id'], recent['id'])

    def test_http_import_and_export(self):
        with TestClient(create_app(self.store.path)) as client:
            response = client.post('/api/commands', json={'request_id': str(uuid4()), 'action': 'import_session', 'payload': self.payload})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(client.get('/api/state').json()['summary']['total_sets'], 2)
            exported = client.get('/api/export.json').json()['sessions'][0]
            self.assertEqual(exported['source']['id'], 'synthetic-source')
            self.assertIn('2026-10-18T17:58:28+00:00', client.get('/api/export.csv').text)
