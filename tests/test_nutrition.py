import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi.testclient import TestClient
from workout.api import create_app
from workout.food_sources import FoodSources
from workout.nutrition import NutritionStore, companion_path, validate_item
from workout.store import DomainError


def food():
    return {'name': 'Synthetic test oats', 'basis': 'per_100g',
            'nutrients': {'kcal': '380', 'protein_g': '13', 'carbs_g': '68', 'fat_g': '7', 'fiber_g': None},
            'source': {'kind': 'label', 'url': 'https://example.org/label', 'notes': 'Synthetic test only'}}


def item():
    return {'food': food(), 'quantity': '50', 'quantity_unit': 'g', 'estimated': False, 'portion_method': 'weighed'}


def meal():
    return {'title': 'Synthetic breakfast', 'occurred_at': '2026-10-19T00:30:00-04:00', 'status': 'logged', 'items': [item()], 'evidence': 'Synthetic photo fixture'}


class NutritionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = NutritionStore(Path(self.temp.name) / 'nutrition.sqlite3')

    def tearDown(self):
        self.temp.cleanup()

    def command(self, action, payload, revision=None, request_id=None):
        return self.store.command(request_id or str(uuid4()), action, payload, revision)

    def test_exact_scaling_missing_values_estimates_and_timezones(self):
        payload = meal()
        payload['items'][0].update(estimated=False, portion_method='photo_estimate')
        saved = self.command('log_meal', payload)['result']
        self.assertTrue(saved['estimated'])
        self.assertEqual(saved['occurred_at'], '2026-10-19T04:30:00+00:00')
        state = self.store.state('2026-10-19')
        self.assertEqual(state['totals']['kcal'], {'known': '190', 'missing_items': 0})
        self.assertEqual(state['totals']['fiber_g'], {'known': '0', 'missing_items': 1})
        self.assertEqual(self.store.state('2026-10-18', 'America/Los_Angeles')['logged_meals'], 1)
        self.assertEqual(self.store.state('2026-10-19', 'America/Los_Angeles')['coverage'], 'unlogged')
        self.assertEqual(self.store.history('2026-10-18', '2026-10-19')['days'][0]['coverage'], 'unlogged')

    def test_retries_conflicts_correction_soft_delete_restore_audit(self):
        rid = str(uuid4())
        saved = self.command('log_meal', meal(), request_id=rid)
        self.assertEqual(saved, self.command('log_meal', meal(), request_id=rid))
        self.assertEqual(len(self.store.export()['meals']), 1)
        changed = meal(); changed['title'] = 'Different'
        with self.assertRaises(DomainError) as caught:
            self.command('log_meal', changed, request_id=rid)
        self.assertEqual(caught.exception.code, 'idempotency_conflict')
        mid = saved['result']['id']
        changed['items'][0]['quantity'] = '75'
        edited = self.command('edit_meal', {'meal_id': mid, 'meal': changed}, 0)['result']
        self.assertEqual(edited['revision'], 1)
        self.assertEqual(edited['totals']['kcal']['known'], '285')
        with self.assertRaises(DomainError) as caught:
            self.command('delete_meal', {'meal_id': mid}, 0)
        self.assertEqual(caught.exception.code, 'revision_conflict')
        self.command('delete_meal', {'meal_id': mid}, 1)
        self.assertEqual(self.store.state('2026-10-19')['logged_meals'], 0)
        self.command('restore_meal', {'meal_id': mid}, 2)
        self.assertEqual(self.store.state('2026-10-19')['logged_meals'], 1)
        exported = self.store.export()
        self.assertEqual(len(exported['events']), 4)
        self.assertEqual(exported['events'][1]['before_data']['items'][0]['quantity'], '50')
        with sqlite3.connect(self.store.path) as db:
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('DELETE FROM nutrition_events')

    def test_drafts_saved_foods_and_snapshots(self):
        payload = meal(); payload['status'] = 'draft'
        saved = self.command('log_meal', payload)['result']
        self.assertEqual(self.store.state('2026-10-19')['coverage'], 'unlogged')
        self.command('save_food', {'food': food()})
        self.assertEqual(len(self.store.state('2026-10-19')['foods']), 1)
        replacement = food(); replacement['nutrients']['kcal'] = '1'
        self.command('save_food', {'food': replacement})
        self.assertEqual(self.store.export()['meals'][0]['items'][0]['food']['nutrients']['kcal'], '380')
        payload['status'] = 'logged'
        self.command('edit_meal', {'meal_id': saved['id'], 'meal': payload}, 0)
        self.assertEqual(self.store.state('2026-10-19')['totals']['kcal']['known'], '190')

    def test_mass_volume_and_serving_units_never_assumed(self):
        for basis, unit, quantity, expected in [('per_100g','g','10','38'), ('per_100ml','ml','250','950'), ('per_serving','serving','1.5','570')]:
            entry = item(); entry['food']['basis'] = basis; entry.update(quantity_unit=unit,quantity=quantity)
            self.assertEqual(validate_item(entry)['totals']['kcal'], expected)
            for wrong in {'g','ml','serving','cup'} - {unit}:
                entry['quantity_unit'] = wrong
                with self.assertRaises(DomainError): validate_item(entry)

    def test_invalid_values_fail_atomically(self):
        modifications = [lambda m: m.update(occurred_at='2026-10-19T12:00:00'),
                         lambda m: m['items'][0].update(quantity=True),
                         lambda m: m['items'][0].update(quantity='NaN'),
                         lambda m: m['items'][0].update(quantity='-1'),
                         lambda m: m['items'][0].update(quantity='1e-999'),
                         lambda m: m['items'][0].update(estimated='false'),
                         lambda m: m['items'][0]['food'].update(basis=[]),
                         lambda m: m['items'][0]['food']['source'].update(kind=[]),
                         lambda m: m['items'][0]['food']['source'].update(url='javascript:alert(1)'),
                         lambda m: m['items'][0]['food']['nutrients'].update(kcal=True),
                         lambda m: m['items'][0]['food']['nutrients'].update(kcal='Infinity'),
                         lambda m: m['items'][0]['food'].update(nutrients={}),
                         lambda m: m.update(items=[])]
        for modify in modifications:
            payload = meal(); modify(payload)
            with self.subTest(payload=payload):
                with self.assertRaises(DomainError): self.command('log_meal', payload)
        self.assertEqual(self.store.export()['meals'], [])
        self.assertEqual(self.store.export()['events'], [])

    def test_pagination_range_validation(self):
        for _ in range(3): self.command('log_meal', meal())
        first = self.store.state('2026-10-19',page_size=2)
        second = self.store.state('2026-10-19',page=2,page_size=2)
        self.assertTrue(first['has_more']); self.assertFalse(second['has_more'])
        self.assertEqual(first['totals'], second['totals'])
        self.assertEqual(len(second['meals']), 1)
        for args in [('2026-10-19','2026-10-18'), ('2020-01-01','2026-01-01'), ('garbage','garbage')]:
            with self.assertRaises(DomainError): self.store.history(*args)
        with self.assertRaises(DomainError): self.store.state('2026-10-19','Invalid/Zone')

    def test_provider_parsing_and_nulls(self):
        sources = FoodSources()
        fixture = {'foods':[{'fdcId':1,'description':'Test raw food','foodNutrients':[
            {'nutrientId':1008,'unitName':'KCAL','value':100},
            {'nutrientId':1003,'unitName':'G','value':10},
            {'nutrientId':1004,'unitName':'MG','value':100}]}], 'totalPages':2}
        with patch.object(sources,'_get',return_value=fixture) as get:
            result = sources.search('test')
            self.assertTrue(result['has_more'])
            self.assertEqual(result['foods'][0]['nutrients']['kcal'], '100')
            self.assertIsNone(result['foods'][0]['nutrients']['fat_g'])
            self.assertTrue(get.call_args.args[0].startswith('https://api.nal.usda.gov/'))
        with patch.object(sources,'_get',return_value={'product':{'product_name':'Drink','product_quantity_unit':'ml','nutriments':{'energy-kcal_100g':40}}}):
            result = sources.barcode('12345678')
            self.assertEqual(result['food']['basis'],'per_100ml')
            self.assertIsNone(result['food']['nutrients']['protein_g'])
        with self.assertRaises(DomainError): sources.barcode('../evil')

    def test_explicit_chat_journal_path_keeps_workout_test_copy_isolated(self):
        from workout.mcp_server import create_server
        workout = Path(self.temp.name) / 'test-workouts.sqlite3'
        journal = Path(self.temp.name) / 'selected-journal.sqlite3'
        create_server(workout, journal)
        self.assertTrue(workout.exists())
        self.assertTrue(journal.exists())
        self.assertFalse(companion_path(workout).exists())
        self.assertEqual(NutritionStore(journal).state('2026-10-19')['logged_meals'], 0)

    def test_http_contract_separation_security_and_export(self):
        path = Path(self.temp.name) / 'workouts.sqlite3'
        with TestClient(create_app(path)) as client:
            before = client.get('/api/export.json').json()
            payload = {'request_id':str(uuid4()),'action':'log_meal','payload':meal()}
            result = client.post('/api/nutrition/commands',json=payload)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(client.post('/api/nutrition/commands',json=payload).json(),result.json())
            fresh = client.get('/api/nutrition/state?day=2026-10-19').json()
            self.assertEqual(fresh['logged_meals'],1)
            self.assertEqual(client.get('/api/export.json').json()['sessions'],before['sessions'])
            self.assertEqual(len(client.get('/api/nutrition/export.json').json()['events']),1)
            self.assertTrue(companion_path(path).exists())
            self.assertEqual(client.post('/api/nutrition/commands',json=payload,headers={'Origin':'https://evil.example'}).status_code,403)
            self.assertEqual(client.get('/api/nutrition/state?day=bad').status_code,400)
            self.assertEqual(client.get('/api/nutrition/state?day=2026-10-19&page_size=1000').status_code,422)
            self.assertEqual(client.post('/api/nutrition/commands',json={**payload,'expected_revision':True}).status_code,422)


if __name__ == '__main__': unittest.main()
