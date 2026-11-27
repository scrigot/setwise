"""Dated bodyweight and creatine records in the authorized nutrition journal."""
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import json
from uuid import uuid4

from .nutrition import amount, calendar_range, optional_text
from .store import DomainError, decimal_text, dumps, fields, import_timestamp, now, text_field


class TrackingStore:
    def __init__(self, nutrition):
        self.connect = nutrition.connect
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS tracking_entries(id TEXT PRIMARY KEY, day TEXT NOT NULL, timezone TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(day,timezone,kind));
                CREATE TABLE IF NOT EXISTS tracking_commands(request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS tracking_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, before_data TEXT, after_data TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS tracking_events_no_update BEFORE UPDATE ON tracking_events BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
                CREATE TRIGGER IF NOT EXISTS tracking_events_no_delete BEFORE DELETE ON tracking_events BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
            ''')

    def command(self, request_id, action, payload, expected_revision=None):
        request_id = text_field(request_id, 'request_id', 128)
        if action not in ('save_entry', 'remove_entry', 'restore_entry'):
            raise DomainError('unknown_action', 'Unknown tracking action.')
        if expected_revision is not None and (type(expected_revision) is not int or expected_revision < 0):
            raise DomainError('invalid_input', 'expected_revision must be a nonnegative integer.')
        fields(payload, {'day','timezone','kind','value','unit','occurred_at','notes'} if action == 'save_entry' else {'day','timezone','kind'}, {'day','timezone','kind'})
        day, _, zone = calendar_range(payload['day'], payload['day'], payload['timezone'])
        kind = payload['kind']
        if kind not in ('bodyweight', 'creatine'):
            raise DomainError('invalid_input', 'kind must be bodyweight or creatine.')
        content = None
        if action == 'save_entry':
            unit = payload.get('unit')
            if unit not in (('lb','kg') if kind == 'bodyweight' else ('g',)):
                raise DomainError('invalid_unit', 'Bodyweight needs explicit lb or kg; creatine uses grams.')
            value = payload.get('value')
            if value is None and kind == 'bodyweight':
                raise DomainError('invalid_input', 'Supply the measured bodyweight; never infer it.')
            numeric = None if value is None else amount(value, 'value', positive=True)
            kg = None if kind != 'bodyweight' else numeric * (Decimal('0.45359237') if unit == 'lb' else 1)
            if (kg is not None and kg > 1000) or (kind == 'creatine' and numeric is not None and numeric > 100):
                raise DomainError('invalid_input', 'Value is outside the supported tracking range; check units.')
            occurred = None if payload.get('occurred_at') is None else import_timestamp(payload['occurred_at'], 'occurred_at')
            if occurred:
                from datetime import datetime
                if datetime.fromisoformat(occurred).astimezone(zone).date() != day:
                    raise DomainError('invalid_input', 'Exact time must match the entry date and timezone.')
            content = {'day': day.isoformat(), 'timezone': payload['timezone'], 'kind': kind,
                       'value': None if numeric is None else decimal_text(numeric), 'unit': unit,
                       'weight_kg': None if kg is None else decimal_text(kg), 'taken': kind == 'creatine',
                       'occurred_at': occurred, 'notes': optional_text(payload.get('notes'), 'notes')}
        try:
            fingerprint = hashlib.sha256(dumps([action,payload,expected_revision]).encode()).hexdigest()
        except (ValueError, TypeError):
            raise DomainError('invalid_input','Command must contain valid JSON values.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM tracking_commands WHERE request_id=?',(request_id,)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise DomainError('idempotency_conflict','Request ID was used with different arguments.',409)
                return json.loads(previous['response'])
            row = db.execute('SELECT data FROM tracking_entries WHERE day=? AND timezone=? AND kind=?',(day.isoformat(),payload['timezone'],kind)).fetchone()
            before = json.loads(row[0]) if row else None
            if before and expected_revision != before['revision']:
                raise DomainError('revision_conflict','An entry already exists. Read its revision before correcting it.',409)
            if not before and (expected_revision is not None or action != 'save_entry'):
                raise DomainError('not_found','Tracking entry does not exist.',404)
            if before and before['deleted'] and action == 'save_entry':
                raise DomainError('entry_deleted','Restore the entry before editing.',409)
            result = {**(before or {'id':str(uuid4()),'created_at':now()}), **(content or {}),
                      'revision': before['revision']+1 if before else 0, 'updated_at':now(),
                      'deleted': action == 'remove_entry'}
            db.execute('INSERT OR REPLACE INTO tracking_entries VALUES(?,?,?,?,?)',(result['id'],result['day'],result['timezone'],kind,dumps(result)))
            cursor = db.execute('INSERT INTO tracking_events(at,request_id,before_data,after_data) VALUES(?,?,?,?)',(now(),request_id,dumps(before) if before else None,dumps(result)))
            response = {'result':result,'event_id':cursor.lastrowid}
            db.execute('INSERT INTO tracking_commands VALUES(?,?,?)',(request_id,fingerprint,dumps(response)))
            return response

    def state(self, start_date, end_date, timezone='America/New_York'):
        start, end, _ = calendar_range(start_date,end_date,timezone)
        # Read six earlier dates too, so the first displayed day's average is correct.
        with self.connect() as db:
            rows = [json.loads(r[0]) for r in db.execute('SELECT data FROM tracking_entries WHERE timezone=? AND day>=? AND day<=? ORDER BY day DESC,kind',(timezone,(start-timedelta(days=6)).isoformat(),end.isoformat()))]
        weights = {date.fromisoformat(r['day']):Decimal(r['weight_kg']) for r in rows if r['kind']=='bodyweight' and not r['deleted']}
        trend = []
        day = start
        while day <= end:
            values = [v for d,v in weights.items() if day-timedelta(days=6) <= d <= day]
            average = sum(values)/len(values) if values else None
            trend.append({'day':day.isoformat(),'measurements':len(values),'average_kg':None if average is None else decimal_text(average.quantize(Decimal('.000001')))})
            if day == end: break
            day += timedelta(days=1)
        return {'timezone':timezone,'entries':[r for r in rows if r['day']>=start.isoformat()], 'trend':trend,
                'coverage':'Recorded dates only. Missing creatine entries do not mean missed doses. Seven-day averages use available daily weights, with no filled values.'}

    def export(self):
        with self.connect() as db:
            db.execute('BEGIN')
            return {'schema_version':1,'entries':[json.loads(r[0]) for r in db.execute('SELECT data FROM tracking_entries ORDER BY day,kind')],
                    'events':[{**dict(r),'before_data':json.loads(r['before_data']) if r['before_data'] else None,'after_data':json.loads(r['after_data'])} for r in db.execute('SELECT * FROM tracking_events ORDER BY seq')]}
