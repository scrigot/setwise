import tempfile
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from workout.api import create_app
from workout.store import DomainError, Store


class BulkImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = self.temp.name + '/test.sqlite3'
        self.store = Store(self.path)
        self.entry = {'exercise': 'Variant A', 'exercise_type': 'weight_reps', 'exercise_template_id': 'source-exercise',
                      'load': '71.5', 'unit': 'lb', 'reps': 6, 'rpe': None, 'set_type': 'dropset',
                      'notes': 'Straight bar', 'rest_seconds': 90, 'superset_id': 1}
        self.routine = {'name': 'Imported routine', 'created_at': '2026-08-28T01:03:13.131Z',
                        'updated_at': '2026-08-28T01:37:08.031Z', 'source': {'system': 'hevy', 'id': 'routine-1'},
                        'sets': [self.entry], 'source_data': {'folder_id': None, 'weight_kg': 32.43189302464824}}

    def tearDown(self):
        self.temp.cleanup()

    def command(self, action, payload, rid=None):
        return self.store.command(rid or str(uuid4()), action, payload)

    def test_routine_import_is_idempotent_and_keeps_metadata(self):
        active = self.command('start_session', {'title': 'Unrelated'})['result']
        rid = str(uuid4())
        first = self.command('import_routine', self.routine, rid)
        self.assertEqual(self.command('import_routine', self.routine, rid), first)
        with self.assertRaises(DomainError) as ctx:
            self.command('import_routine', self.routine)
        self.assertEqual(ctx.exception.code, 'duplicate_source')
        state = Store(self.path).state()
        self.assertEqual(state['active_session'], active)
        self.assertEqual(len(state['sessions']), 1)
        self.assertEqual(len(state['routines']), 1)
        entry = state['routines'][0]['template'][0]
        for key, value in self.entry.items():
            self.assertEqual(entry[key], value)
        self.assertEqual(first['result']['created_at'], '2026-08-28T01:03:13.131000+00:00')
        self.assertEqual(first['result']['source_data'], self.routine['source_data'])

    def test_reps_only_preserves_absent_weight(self):
        payload = {**self.routine, 'sets': [{'exercise': 'Leg raise', 'exercise_type': 'reps_only', 'load': None,
                                          'unit': 'lb', 'reps': 13}]}
        result = self.command('import_routine', payload)['result']['template'][0]
        self.assertIsNone(result['source_load'])
        self.assertEqual(result['load_kg'], '0')
        self.assertEqual(result['exercise_type'], 'reps_only')
        bad = {**payload, 'source': {'system': 'hevy', 'id': 'bad'}, 'sets': [{**payload['sets'][0], 'load': '5'}]}
        with self.assertRaises(DomainError):
            self.command('import_routine', bad)
        self.assertEqual(len(self.store.state()['routines']), 1)

    def test_unset_routine_load_stays_a_plan_and_is_not_a_completed_set(self):
        payload = {**self.routine, 'sets': [{**self.entry, 'load': None, 'rpe': None}]}
        routine = self.command('import_routine', payload)['result']
        self.assertTrue(routine['template'][0]['load_unset'])
        self.assertIsNone(routine['template'][0]['source_load'])
        active = self.command('start_session', {'title': 'Planned workout', 'routine_id': routine['id']})['result']
        self.assertEqual(active['sets'], [])
        self.assertTrue(active['plan'][0]['load_unset'])
        self.assertEqual(self.store.state()['summary']['total_sets'], 0)
        with self.assertRaises(DomainError):
            self.command('import_session', {'title': 'Invalid completed workout',
                'started_at': '2026-10-19T12:00:00Z', 'finished_at': '2026-10-19T12:30:00Z',
                'source': {'system': 'test', 'id': 'unset-completed'}, 'sets': payload['sets']})
        with self.assertRaises(DomainError):
            self.store.command(str(uuid4()), 'log_set', {'session_id': active['id'],
                'exercise': 'Bench press', 'load': None, 'unit': 'lb', 'reps': 5}, 0)
        self.assertEqual(self.store.state()['active_session']['sets'], [])

    def test_reference_preserves_raw_workout_without_changing_corrected_session(self):
        corrected = self.command('import_session', {'title': 'Corrected', 'started_at': '2026-10-18T17:58:28Z',
            'finished_at': '2026-10-18T18:25:11Z', 'source': {'system': 'hevy', 'id': 'today'},
            'sets': [{**self.entry, 'exercise': 'Pec Deck Machine', 'rpe': 9}]})['result']
        payload = {'kind': 'workout_source', 'source': {'system': 'hevy', 'id': 'today'},
                   'source_data': {'title': 'Mislabeled fly', 'rpe': None}}
        self.command('import_reference', payload)
        with self.assertRaises(DomainError):
            self.command('import_reference', payload)
        self.assertEqual(self.store.state()['sessions'][0], corrected)
        self.assertEqual(self.store.export()['imported_references'][0]['source_data'], payload['source_data'])

    def test_reference_preferences_api_and_invalid_rollback(self):
        payload = {'kind': 'preferences', 'source': {'system': 'hevy', 'id': 'user'},
                   'source_data': {'weight_unit': 'lbs', 'distance_unit': 'miles'}}
        with TestClient(create_app(self.path)) as client:
            response = client.post('/api/commands', json={'request_id': str(uuid4()), 'action': 'import_reference', 'payload': payload})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(client.get('/api/state').json()['imported_references'][0]['source_data'], payload['source_data'])
        before = self.store.export()
        with self.assertRaises(DomainError):
            self.command('import_reference', {**payload, 'source': {'system': 'hevy', 'id': 'bad'}, 'source_data': {'weight_unit': 'stone'}})
        self.assertEqual(self.store.export()['events'], before['events'])

    def test_old_database_upgrade_keeps_records(self):
        active = self.command('start_session', {'title': 'Existing'})['result']
        with self.store.connect() as db:
            db.execute('DROP TABLE imported_references')
        upgraded = Store(self.path)
        self.assertEqual(upgraded.state()['active_session'], active)
        self.assertEqual(upgraded.state()['imported_references'], [])
