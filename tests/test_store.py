import concurrent.futures
from decimal import Decimal
import sqlite3
import tempfile
import unittest
from uuid import uuid4

from workout.store import DomainError, Store


def key():
    return str(uuid4())


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = self.temp.name + '/workouts.sqlite3'
        self.store = Store(self.path)
        self.session = self.store.command(key(), 'start_session', {'title': 'Synthetic test workout'})['result']
        self.id = self.session['id']

    def tearDown(self):
        self.temp.cleanup()

    def add(self, **changes):
        body = {'session_id': self.id, 'exercise': 'Bench press', 'load': '100', 'unit': 'lb', 'reps': 8, 'rpe': 8.5}
        body.update(changes)
        rev = self.store.state()['active_session']['revision']
        return self.store.command(key(), 'log_set', body, rev)['result']

    def mutate(self, action, **payload):
        rev = self.store.state()['active_session']['revision']
        return self.store.command(key(), action, {'session_id': self.id, **payload}, rev)['result']

    def assert_code(self, code, call):
        with self.assertRaises(DomainError) as cm:
            call()
        self.assertEqual(cm.exception.code, code)

    def test_exact_pound_conversion_and_original_preserved(self):
        entry = self.add()['sets'][0]
        self.assertEqual(entry['load'], '100')
        self.assertEqual(entry['unit'], 'lb')
        self.assertEqual(entry['load_kg'], '45.359237')
        self.assertEqual(self.add(load='45.3592', unit='kg')['sets'][1]['load_kg'], '45.3592')

    def test_idempotent_retry_is_exact_and_does_not_duplicate(self):
        rid = key()
        payload = {'session_id': self.id, 'exercise': 'Squat', 'load': '80', 'unit': 'kg', 'reps': 5}
        first = self.store.command(rid, 'log_set', payload, 0)
        self.add()
        second = self.store.command(rid, 'log_set', payload, 0)
        self.assertEqual(first, second)
        self.assertEqual(len(self.store.state()['active_session']['sets']), 2)
        self.assertEqual(len(self.store.events(self.id)), 3)

    def test_reuse_key_with_changed_payload_rejected(self):
        rid = key()
        self.store.command(rid, 'save_routine', {'name': 'A', 'session_id': self.add()['id']})
        self.assert_code('idempotency_conflict', lambda: self.store.command(rid, 'save_routine', {'name': 'B', 'session_id': self.id}))

    def test_edit_then_undo_keeps_stable_id_and_audit(self):
        entry = self.add()['sets'][0]
        corrected = self.mutate('edit_set', set_id=entry['id'], exercise=entry['exercise'], load='100', unit='lb', reps=6)
        self.assertEqual(corrected['sets'][0]['id'], entry['id'])
        self.assertEqual(corrected['sets'][0]['reps'], 6)
        self.assertIsNone(corrected['sets'][0]['rpe'])
        undone = self.mutate('undo')
        self.assertEqual(undone['sets'][0]['reps'], 8)
        self.assertEqual(undone['sets'][0]['rpe'], 8.5)
        events = self.store.events(self.id)
        self.assertEqual([e['action'] for e in events], ['start_session', 'log_set', 'edit_set', 'undo'])
        self.assertEqual(events[2]['before']['sets'][0]['reps'], 8)
        self.assertEqual(events[2]['after']['sets'][0]['reps'], 6)
        self.assertEqual(events[3]['undoes'], events[2]['id'])

    def test_remove_then_undo_restores_position(self):
        one = self.add()['sets'][0]
        two = self.add(exercise='Row')['sets'][1]
        removed = self.mutate('remove_set', set_id=one['id'])
        self.assertEqual(removed['sets'], [two])
        self.assertEqual(self.mutate('undo')['sets'], [one, two])

    def test_undo_multiple_changes_then_new_branch(self):
        self.add()
        self.add(exercise='Row')
        self.mutate('undo')
        result = self.mutate('undo')
        self.assertFalse(result['can_undo'])
        self.assertEqual(result['sets'], [])
        self.assert_code('nothing_to_undo', lambda: self.mutate('undo'))
        self.add(exercise='Deadlift')
        self.assertEqual(self.mutate('undo')['sets'], [])

    def test_stale_revision_rejected_without_side_effect(self):
        self.add()
        self.assert_code('revision_conflict', lambda: self.store.command(key(), 'finish_session', {'session_id': self.id}, 0))
        self.assertEqual(len(self.store.events(self.id)), 2)
        self.assertEqual(self.store.state()['active_session']['revision'], 1)

    def test_revision_required_and_boolean_not_accepted(self):
        self.assert_code('revision_required', lambda: self.store.command(key(), 'finish_session', {'session_id': self.id}))
        self.assert_code('invalid_revision', lambda: self.store.command(key(), 'finish_session', {'session_id': self.id}, False))

    def test_only_one_active_session(self):
        self.assert_code('active_session_exists', lambda: self.store.command(key(), 'start_session', {'title': 'Other'}))

    def test_finished_session_read_only(self):
        self.add()
        done = self.mutate('finish_session')
        self.assertIsNone(self.store.state()['active_session'])
        self.assertIsNotNone(done['finished_at'])
        self.assert_code('session_finished', lambda: self.store.command(key(), 'undo', {'session_id': self.id}, done['revision']))

    def test_routine_is_snapshot_not_completed_sets(self):
        self.add()
        routine = self.store.command(key(), 'save_routine', {'session_id': self.id, 'name': 'A day'})['result']
        self.mutate('undo')
        self.mutate('finish_session')
        started = self.store.command(key(), 'start_session', {'title': 'Next day', 'routine_id': routine['id']})['result']
        self.assertEqual(len(started['plan']), 1)
        self.assertEqual(started['sets'], [])
        self.assertEqual(started['plan'][0]['load'], '100')

    def test_mixed_units_summary_uses_finished_sessions_only(self):
        self.add(load='100', unit='lb', reps=10)
        self.add(exercise='bench PRESS', load='50', unit='kg', reps=10)
        self.assertEqual(self.store.state()['summary']['total_sets'], 0)
        self.mutate('finish_session')
        summary = self.store.state()['summary']
        self.assertEqual(summary['total_sets'], 2)
        self.assertEqual(Decimal(summary['volume_kg']), Decimal('953.59237'))
        self.assertEqual(len(summary['exercises']), 1)
        self.assertEqual(summary['exercises'][0]['best_load_kg'], '50')

    def test_progression_compares_exact_variants_without_merging(self):
        self.add(exercise='Bench press', load='100', unit='lb', reps=8, rpe=8)
        self.add(exercise='Larsen press', load='80', unit='lb', reps=8, rpe=9)
        self.mutate('finish_session')
        self.id = self.store.command(key(), 'start_session', {'title': 'Next test'})['result']['id']
        self.add(exercise='bench PRESS', load='105', unit='lb', reps=8, rpe=8.5)
        self.mutate('finish_session')
        stats = {s['exercise'].casefold(): s for s in self.store.state()['summary']['exercises']}
        self.assertEqual(len(stats), 2)
        bench = stats['bench press']
        self.assertEqual(len(bench['history']), 2)
        self.assertEqual(bench['history'][0]['mean_rpe'], '8.5')
        self.assertEqual(bench['comparison']['total_reps_delta'], 0)
        self.assertEqual(Decimal(bench['comparison']['best_load_delta_kg']), Decimal('2.26796185'))
        self.assertIsNone(stats['larsen press']['comparison'])

    def test_bad_inputs_rollback(self):
        cases = [({'unit': 'lbs'}, 'invalid_unit'), ({'load': '-1'}, 'invalid_load'),
                 ({'load': 'nan'}, 'invalid_load'), ({'load': 'Infinity'}, 'invalid_load'),
                 ({'load': '1.00001'}, 'invalid_load'), ({'load': True}, 'invalid_load'),
                 ({'reps': True}, 'invalid_reps'), ({'reps': 1.5}, 'invalid_reps'),
                 ({'reps': 0}, 'invalid_reps'), ({'rpe': 10.5}, 'invalid_rpe'),
                 ({'rpe': 8.2}, 'invalid_rpe'), ({'rpe': True}, 'invalid_rpe'),
                 ({'exercise': '   '}, 'invalid_input')]
        for values, code in cases:
            with self.subTest(values=values):
                self.assert_code(code, lambda: self.add(**values))
        self.assertEqual(self.store.state()['active_session']['revision'], 0)
        self.assertEqual(len(self.store.events(self.id)), 1)

    def test_unknown_fields_rejected(self):
        self.assert_code('invalid_input', lambda: self.add(load_kg='900'))

    def test_persistence_on_new_store_instance(self):
        self.add()
        self.assertEqual(Store(self.path).state(), self.store.state())

    def test_future_schema_is_not_silently_downgraded(self):
        with self.store.connect() as db:
            db.execute('PRAGMA user_version=2')
        self.assert_code('unsupported_schema', lambda: Store(self.path))
        with self.store.connect() as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 2)

    def test_audit_is_append_only(self):
        with self.store.connect() as db:
            for sql in ['DELETE FROM events', "UPDATE events SET action='other'"]:
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute(sql)

    def test_concurrent_same_key_creates_exactly_one_set(self):
        rid = key()
        payload = {'session_id': self.id, 'exercise': 'Squat', 'load': '60', 'unit': 'kg', 'reps': 5}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.store.command(rid, 'log_set', payload, 0), range(8)))
        self.assertTrue(all(r == results[0] for r in results))
        self.assertEqual(len(self.store.state()['active_session']['sets']), 1)

    def test_concurrent_different_keys_rejects_stale_writer(self):
        payload = {'session_id': self.id, 'exercise': 'Squat', 'load': '60', 'unit': 'kg', 'reps': 5}
        def attempt(_):
            try:
                self.store.command(key(), 'log_set', payload, 0)
                return 'saved'
            except DomainError as exc:
                return exc.code
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(attempt, range(8)))
        self.assertEqual(results.count('saved'), 1)
        self.assertEqual(results.count('revision_conflict'), 7)

    def test_export_includes_audit_and_routines(self):
        self.add()
        self.store.command(key(), 'save_routine', {'session_id': self.id, 'name': 'A'})
        exported = self.store.export()
        self.assertEqual(exported['schema_version'], 1)
        self.assertEqual(len(exported['sessions']), 1)
        self.assertEqual(len(exported['routines']), 1)
        self.assertEqual(len(exported['events']), 3)


if __name__ == '__main__':
    unittest.main()
