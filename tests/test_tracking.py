from pathlib import Path
import sqlite3
import tempfile
import unittest
from uuid import uuid4
from fastapi.testclient import TestClient
from workout.api import create_app
from workout.nutrition import NutritionStore
from workout.tracking import TrackingStore
from workout.store import DomainError


class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.nutrition=NutritionStore(Path(self.temp.name)/'nutrition.sqlite3')
        self.store=TrackingStore(self.nutrition)

    def tearDown(self): self.temp.cleanup()

    def payload(self,kind='bodyweight',**kwargs):
        return {'day':'2026-10-19','timezone':'America/New_York','kind':kind,'value':'163' if kind=='bodyweight' else None,'unit':'lb' if kind=='bodyweight' else 'g',**kwargs}

    def save(self,payload,revision=None,rid=None):
        return self.store.command(rid or str(uuid4()),'save_entry',payload,revision)

    def test_dated_unknown_dose_retry_and_correction(self):
        p=self.payload('creatine');rid=str(uuid4());saved=self.save(p,rid=rid)
        self.assertEqual(saved,self.save(p,rid=rid))
        self.assertIsNone(saved['result']['value']);self.assertIsNone(saved['result']['occurred_at'])
        self.assertTrue(saved['result']['taken'])
        with self.assertRaises(DomainError):self.save(p)
        with self.assertRaises(DomainError):self.save({**p,'value':'5'},rid=rid)
        edited=self.save({**p,'value':'5'},0)['result']
        self.assertEqual(edited['revision'],1)
        minimal={k:p[k] for k in ('day','timezone','kind')}
        self.store.command(str(uuid4()),'remove_entry',minimal,1)
        self.assertTrue(self.store.state('2026-10-19','2026-10-19')['entries'][0]['deleted'])
        self.store.command(str(uuid4()),'restore_entry',minimal,2)
        self.assertFalse(self.store.state('2026-10-19','2026-10-19')['entries'][0]['deleted'])
        self.assertEqual(len(self.store.export()['events']),4)
        with self.nutrition.connect() as db:
            with self.assertRaises(sqlite3.IntegrityError):db.execute('DELETE FROM tracking_events')

    def test_weight_units_missing_days_and_rolling_window(self):
        self.save(self.payload(day='2026-10-12',value='200')) # outside window
        self.save(self.payload(day='2026-10-13',value='160'))
        self.save(self.payload(value='74',unit='kg'))
        self.save(self.payload('creatine'))
        state=self.store.state('2026-10-19','2026-10-19')
        self.assertEqual(state['trend'][0]['measurements'],2)
        self.assertEqual(state['trend'][0]['average_kg'],'73.28739')
        self.assertEqual(len(state['entries']),2)
        self.assertEqual(self.store.state('2026-10-20','2026-10-20')['trend'][0]['measurements'],1)
        self.assertEqual(self.store.state('2026-10-19','2026-10-19','UTC')['entries'],[])

    def test_invalid_data_never_writes_or_guesses(self):
        for changes in ({'value':None},{'value':True},{'value':'NaN'},{'value':'-1'},{'value':'0'},{'unit':'g'},{'unit':None},{'kind':'other'},{'timezone':'bad'},{'day':'bad'},{'occurred_at':'2026-10-19T12:00:00'},{'occurred_at':'2026-10-20T12:00:00Z'}):
            with self.subTest(changes=changes),self.assertRaises(DomainError):self.save(self.payload(**changes))
        with self.assertRaises(DomainError):self.save(self.payload('creatine',value='101'))
        self.assertEqual(self.store.export()['entries'],[])
        self.assertEqual(self.store.export()['events'],[])

    def test_existing_meals_unchanged_and_http_security_export(self):
        path=Path(self.temp.name)/'workouts.sqlite3'
        with TestClient(create_app(path)) as client:
            before=client.get('/api/nutrition/export.json').json()
            command={'request_id':str(uuid4()),'action':'save_entry','payload':self.payload('creatine')}
            self.assertEqual(client.post('/api/tracking/commands',json=command).status_code,200)
            self.assertEqual(client.post('/api/tracking/commands',json=command).status_code,200)
            self.assertEqual(client.post('/api/tracking/commands',json=command,headers={'Origin':'https://evil.example'}).status_code,403)
            self.assertEqual(client.post('/api/tracking/commands',json={**command,'expected_revision':True}).status_code,422)
            after=client.get('/api/nutrition/export.json').json()
            self.assertEqual(before['meals'],after['meals']);self.assertEqual(before['events'],after['events'])
            self.assertEqual(len(after['tracking']['entries']),1)
            self.assertEqual(len(after['tracking']['events']),1)
            self.assertEqual(client.get('/api/tracking/state?start_date=2026-10-19&end_date=2026-10-19').json()['entries'][0]['kind'],'creatine')
            self.assertEqual(client.get('/api/tracking/state?start_date=bad&end_date=bad').status_code,400)
