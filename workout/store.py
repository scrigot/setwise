"""Deterministic workout commands shared by HTTP and MCP. No model dependency."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any
from uuid import uuid4

LB_TO_KG = Decimal('0.45359237')
UNDOABLE = {'log_set', 'edit_set', 'remove_set'}
ACTIONS = {'import_reference', 'import_routine', 'import_session', 'start_session', 'log_set', 'edit_set', 'remove_set', 'undo', 'finish_session', 'save_routine'}


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, details=None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details

    def as_dict(self):
        result = {'code': self.code, 'message': self.message}
        if self.details is not None:
            result['details'] = self.details
        return result


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def dumps(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def decimal_text(value: Decimal) -> str:
    return format(value.normalize(), 'f') if value else '0'


def text_field(value, field: str, max_length: int = 100) -> str:
    if not isinstance(value, str) or not (value := ' '.join(value.split())) or len(value) > max_length:
        raise DomainError('invalid_input', f'{field} must contain 1–{max_length} characters.')
    return value


def fields(payload, allowed, required):
    if not isinstance(payload, dict):
        raise DomainError('invalid_input', 'payload must be an object.')
    extra = set(payload) - set(allowed)
    missing = set(required) - set(payload)
    if extra or missing:
        raise DomainError('invalid_input', 'Unexpected or missing fields.', details={'unexpected': sorted(extra), 'missing': sorted(missing)})


def validate_set(payload) -> dict:
    exercise = text_field(payload.get('exercise'), 'exercise')
    unit = payload.get('unit')
    if unit not in ('kg', 'lb'):
        raise DomainError('invalid_unit', 'Use an explicit unit: kg or lb.')
    raw = payload.get('load')
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)) or len(str(raw)) > 32:
        raise DomainError('invalid_load', 'load must be a finite nonnegative number.')
    try:
        load = Decimal(str(raw))
    except InvalidOperation:
        raise DomainError('invalid_load', 'load must be a finite nonnegative number.')
    if not load.is_finite() or load < 0 or load > 2000 or (load != load.quantize(Decimal('0.0001'))):
        raise DomainError('invalid_load', 'load must be between 0 and 2000, with at most four decimal places.')
    reps = payload.get('reps')
    if isinstance(reps, bool) or not isinstance(reps, int) or not 1 <= reps <= 1000:
        raise DomainError('invalid_reps', 'reps must be a whole number between 1 and 1000.')
    rpe = payload.get('rpe')
    if rpe is not None:
        if isinstance(rpe, bool) or not isinstance(rpe, (float, int)) or not 1 <= rpe <= 10 or rpe * 2 != int(rpe * 2):
            raise DomainError('invalid_rpe', 'RPE must be between 1 and 10 in half-point steps, or omitted.')
    return {'exercise': exercise, 'load': decimal_text(load), 'unit': unit, 'reps': reps, 'rpe': rpe,
            'load_kg': decimal_text(load if unit == 'kg' else load * LB_TO_KG)}


def import_timestamp(value, field):
    if not isinstance(value, str) or len(value) > 64:
        raise DomainError('invalid_timestamp', f'{field} must be an ISO timestamp with a timezone.')
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc).isoformat()
    except (ValueError, OverflowError):
        raise DomainError('invalid_timestamp', f'{field} must be an ISO timestamp with a timezone.')


def import_source(value):
    fields(value, {'system', 'id'}, {'system', 'id'})
    return {'system': text_field(value['system'], 'source.system').casefold(),
            'id': text_field(value['id'], 'source.id', 128)}


def source_data(value):
    if not isinstance(value, dict) or len(dumps(value).encode('utf-8')) > 60000:
        raise DomainError('invalid_input', 'source_data must be an object of at most 60000 bytes.')
    return value


def import_sets(entries, *, allow_unset_load=False):
    if not isinstance(entries, list) or not 1 <= len(entries) <= 500:
        raise DomainError('invalid_input', 'sets must contain 1–500 sets.')
    imported = []
    for entry in entries:
        fields(entry, {'exercise', 'load', 'unit', 'reps', 'rpe', 'rpe_source', 'set_type',
                       'exercise_type', 'exercise_template_id', 'notes', 'rest_seconds', 'superset_id'},
               {'exercise', 'load', 'unit', 'reps'})
        exercise_type = entry.get('exercise_type', 'weight_reps')
        if exercise_type not in ('weight_reps', 'reps_only'):
            raise DomainError('invalid_input', 'This importer supports weight_reps and reps_only exercises.')
        validation = dict(entry)
        load_unset = allow_unset_load and exercise_type == 'weight_reps' and entry['load'] is None
        if load_unset:
            validation['load'] = '0'  # Numeric storage placeholder; no target weight was prescribed.
        if exercise_type == 'reps_only':
            if entry['load'] is not None:
                raise DomainError('invalid_input', 'reps_only imports must have a null load.')
            validation['load'] = '0'  # Internal volume placeholder, not an observed weight.
        validated = validate_set(validation)
        set_type = entry.get('set_type', 'normal')
        if set_type not in ('normal', 'warmup', 'failure', 'dropset'):
            raise DomainError('invalid_input', 'Unknown set type.')
        result = {'id': str(uuid4()), **validated, 'set_type': set_type, 'exercise_type': exercise_type}
        if load_unset:
            result.update(load_unset=True, source_load=None)
        if exercise_type == 'reps_only':
            result['source_load'] = None
        for field, maximum in [('rpe_source', 500), ('exercise_template_id', 128), ('notes', 2000)]:
            if entry.get(field) is not None:
                if field == 'rpe_source' and validated['rpe'] is None:
                    raise DomainError('invalid_input', 'rpe_source requires an RPE value.')
                result[field] = text_field(entry[field], field, maximum)
        for field in ('rest_seconds', 'superset_id'):
            if entry.get(field) is not None:
                value = entry[field]
                if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                    raise DomainError('invalid_input', f'{field} must be a nonnegative integer.')
                result[field] = value
        imported.append(result)
    return imported


class Store:
    def __init__(self, path: str | Path):
        self.path = str(Path(path).expanduser().resolve())
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            version = db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 1):
                raise DomainError('unsupported_schema', 'This database version is not supported. Use a compatible app version; no migration was attempted.')
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('active','finished')),
                    body TEXT NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_session ON sessions(status) WHERE status='active';
                CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS imported_references (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS commands (
                    request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                    session_id TEXT, request_id TEXT UNIQUE NOT NULL, action TEXT NOT NULL,
                    body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS session_events ON events(session_id, sequence);
                CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN
                    SELECT RAISE(ABORT, 'Audit events are append-only'); END;
                CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN
                    SELECT RAISE(ABORT, 'Audit events are append-only'); END;
                PRAGMA user_version=1;
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA synchronous=FULL')
        db.execute('PRAGMA busy_timeout=10000')
        try:
            yield db
        finally:
            db.close()

    def _session(self, db, session_id):
        row = db.execute('SELECT body FROM sessions WHERE id=?', (session_id,)).fetchone()
        if row is None:
            raise DomainError('not_found', 'Session not found.', 404)
        return json.loads(row['body'])

    def _events(self, db, session_id):
        return [json.loads(row['body']) for row in db.execute('SELECT body FROM events WHERE session_id=? ORDER BY sequence', (session_id,))]

    def _undo_stack(self, db, session_id):
        stack = []
        for event in self._events(db, session_id):
            if event['action'] in UNDOABLE:
                stack.append(event)
            elif event['action'] == 'undo':
                stack = [e for e in stack if e['id'] != event['undoes']]
        return stack

    def _decorate(self, db, session):
        return {**session, 'can_undo': session['status'] == 'active' and bool(self._undo_stack(db, session['id']))}

    def _save_session(self, db, session):
        db.execute('INSERT INTO sessions(id,status,body) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body',
                   (session['id'], session['status'], dumps(session)))

    def command(self, request_id: str, action: str, payload: dict, expected_revision: int | None = None) -> dict:
        if not isinstance(request_id, str) or not 8 <= len(request_id) <= 128 or not request_id.isascii() or not all(c.isalnum() or c in '-_' for c in request_id):
            raise DomainError('invalid_request_id', 'Use a unique request_id of 8–128 letters, numbers, dashes or underscores.')
        if action not in ACTIONS:
            raise DomainError('unknown_action', 'Unknown command action.')
        if expected_revision is not None and (isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0):
            raise DomainError('invalid_revision', 'expected_revision must be a nonnegative integer.')
        try:
            canonical = dumps({'action': action, 'payload': payload, 'expected_revision': expected_revision})
        except (ValueError, TypeError):
            raise DomainError('invalid_input', 'Command must contain valid finite JSON values.')
        fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                old = db.execute('SELECT * FROM commands WHERE request_id=?', (request_id,)).fetchone()
                if old:
                    if old['fingerprint'] != fingerprint:
                        raise DomainError('idempotency_conflict', 'This request_id was already used for a different command. Do not reuse it.', 409)
                    db.commit()
                    return json.loads(old['response'])
                before, after, session_id, undoes = None, None, None, None
                if action == 'import_session':
                    fields(payload, {'title', 'started_at', 'finished_at', 'source', 'sets', 'notes', 'source_data'},
                           {'title', 'started_at', 'finished_at', 'source', 'sets'})
                    if expected_revision is not None:
                        raise DomainError('invalid_revision', 'import_session does not take expected_revision.')
                    title = text_field(payload['title'], 'title')
                    started = import_timestamp(payload['started_at'], 'started_at')
                    finished = import_timestamp(payload['finished_at'], 'finished_at')
                    if datetime.fromisoformat(finished) < datetime.fromisoformat(started):
                        raise DomainError('invalid_timestamp', 'finished_at must be at or after started_at.')
                    source = import_source(payload['source'])
                    # BEGIN IMMEDIATE serializes this check with every other import.
                    for row in db.execute('SELECT body FROM sessions'):
                        existing = json.loads(row['body'])
                        if existing.get('source') == source:
                            raise DomainError('duplicate_source', 'This source workout is already imported.', 409,
                                              {'session_id': existing['id']})
                    imported = import_sets(payload['sets'])
                    after = {'id': str(uuid4()), 'title': title, 'status': 'finished', 'revision': 0,
                             'started_at': started, 'finished_at': finished, 'plan': [], 'sets': imported,
                             'source': source}
                    if 'notes' in payload:
                        after['notes'] = text_field(payload['notes'], 'notes', 2000)
                    if 'source_data' in payload:
                        after['source_data'] = source_data(payload['source_data'])
                    session_id = after['id']
                    self._save_session(db, after)
                elif action in ('import_routine', 'import_reference'):
                    if expected_revision is not None:
                        raise DomainError('invalid_revision', f'{action} does not take expected_revision.')
                    if action == 'import_routine':
                        fields(payload, {'name', 'created_at', 'updated_at', 'source', 'sets', 'notes', 'source_data'},
                               {'name', 'created_at', 'updated_at', 'source', 'sets'})
                        table = 'routines'
                        kind = 'routine'
                    else:
                        fields(payload, {'kind', 'source', 'source_data'}, {'kind', 'source', 'source_data'})
                        kind = payload['kind']
                        if kind not in ('preferences', 'exercise_definition', 'routine_folder', 'workout_source'):
                            raise DomainError('invalid_input', 'Unsupported reference kind.')
                        table = 'imported_references'
                    source = import_source(payload['source'])
                    for row in db.execute(f'SELECT body FROM {table}'):
                        existing = json.loads(row['body'])
                        if existing.get('source') == source and existing.get('kind', 'routine') == kind:
                            raise DomainError('duplicate_source', 'This source record is already imported.', 409,
                                              {'id': existing['id']})
                    after = {'id': str(uuid4()), 'source': source}
                    if action == 'import_routine':
                        after.update(name=text_field(payload['name'], 'name'),
                                     created_at=import_timestamp(payload['created_at'], 'created_at'),
                                     updated_at=import_timestamp(payload['updated_at'], 'updated_at'),
                                     template=import_sets(payload['sets'], allow_unset_load=True))
                        if datetime.fromisoformat(after['updated_at']) < datetime.fromisoformat(after['created_at']):
                            raise DomainError('invalid_timestamp', 'updated_at must be at or after created_at.')
                        if 'notes' in payload:
                            after['notes'] = text_field(payload['notes'], 'notes', 2000)
                    else:
                        after.update(kind=kind, imported_at=now())
                    if 'source_data' in payload:
                        after['source_data'] = source_data(payload['source_data'])
                    if kind == 'preferences':
                        data = after['source_data']
                        if data.get('weight_unit') not in ('lbs', 'kg') or data.get('distance_unit') not in ('miles', 'kilometers'):
                            raise DomainError('invalid_input', 'Unsupported unit preferences.')
                    db.execute(f'INSERT INTO {table}(id,body) VALUES(?,?)', (after['id'], dumps(after)))
                elif action == 'start_session':
                    fields(payload, {'title', 'started_at', 'routine_id'}, {'title'})
                    if expected_revision is not None:
                        raise DomainError('invalid_revision', 'start_session does not take expected_revision.')
                    title = text_field(payload['title'], 'title')
                    active = db.execute("SELECT id FROM sessions WHERE status='active'").fetchone()
                    if active:
                        raise DomainError('active_session_exists', 'Finish the active session before starting another.', 409, {'session_id': active['id']})
                    plan = []
                    if payload.get('routine_id'):
                        row = db.execute('SELECT body FROM routines WHERE id=?', (text_field(payload['routine_id'], 'routine_id', 128),)).fetchone()
                        if not row:
                            raise DomainError('not_found', 'Routine not found.', 404)
                        plan = json.loads(row['body'])['template']
                    after = {'id': str(uuid4()), 'title': title, 'status': 'active', 'revision': 0,
                             'started_at': import_timestamp(payload['started_at'], 'started_at') if 'started_at' in payload else now(),
                             'finished_at': None, 'plan': plan, 'sets': []}
                    session_id = after['id']
                    self._save_session(db, after)
                elif action == 'save_routine':
                    fields(payload, {'name', 'session_id'}, {'name', 'session_id'})
                    if expected_revision is not None:
                        raise DomainError('invalid_revision', 'save_routine does not take expected_revision.')
                    name = text_field(payload['name'], 'name')
                    source = self._session(db, text_field(payload['session_id'], 'session_id', 128))
                    if not source['sets']:
                        raise DomainError('empty_session', 'Log at least one set before saving a routine.')
                    after = {'id': str(uuid4()), 'name': name, 'created_at': now(),
                             'template': [{k: s[k] for k in ('exercise','load','unit','reps','rpe')} for s in source['sets']]}
                    db.execute('INSERT INTO routines VALUES(?,?)', (after['id'], dumps(after)))
                    session_id = source['id']
                else:
                    common = {'session_id'}
                    set_fields = {'exercise', 'load', 'unit', 'reps', 'rpe'}
                    allowed = common | (set_fields if action in {'log_set','edit_set'} else set()) | ({'set_id'} if action in {'edit_set','remove_set'} else set())
                    required = allowed - {'rpe'}
                    if action == 'finish_session':
                        allowed.add('finished_at')
                    fields(payload, allowed, required)
                    session_id = text_field(payload['session_id'], 'session_id', 128)
                    before = self._session(db, session_id)
                    if expected_revision is None:
                        raise DomainError('revision_required', 'Read the session and include its expected_revision.', 409)
                    if before['revision'] != expected_revision:
                        raise DomainError('revision_conflict', 'Session changed. Review the current state before retrying with a new request_id.', 409,
                                          {'current_revision': before['revision'], 'session_id': session_id})
                    if before['status'] != 'active':
                        raise DomainError('session_finished', 'Finished sessions are read-only in this MVP.', 409)
                    after = json.loads(dumps(before))
                    if action == 'log_set':
                        after['sets'].append({'id': str(uuid4()), **validate_set(payload)})
                    elif action in {'edit_set', 'remove_set'}:
                        set_id = text_field(payload['set_id'], 'set_id', 128)
                        index = next((i for i, s in enumerate(after['sets']) if s['id'] == set_id), None)
                        if index is None:
                            raise DomainError('not_found', 'Set not found in this session.', 404)
                        if action == 'edit_set':
                            after['sets'][index] = {'id': set_id, **validate_set(payload)}
                        else:
                            after['sets'].pop(index)
                    elif action == 'undo':
                        stack = self._undo_stack(db, session_id)
                        if not stack:
                            raise DomainError('nothing_to_undo', 'There is no set change to undo.', 409)
                        target = stack[-1]
                        after['sets'] = target['before']['sets']
                        undoes = target['id']
                    elif action == 'finish_session':
                        end = import_timestamp(payload['finished_at'], 'finished_at') if 'finished_at' in payload else now()
                        if datetime.fromisoformat(end) < datetime.fromisoformat(before['started_at']):
                            raise DomainError('invalid_timestamp', 'finished_at must be at or after started_at.')
                        after['status'], after['finished_at'] = 'finished', end
                    after['revision'] += 1
                    self._save_session(db, after)
                event = {'id': str(uuid4()), 'request_id': request_id, 'action': action, 'session_id': session_id,
                         'at': now(), 'before': before, 'after': after, 'undoes': undoes}
                db.execute('INSERT INTO events(id,session_id,request_id,action,body) VALUES(?,?,?,?,?)',
                           (event['id'], session_id, request_id, action, dumps(event)))
                result = after if action in ('save_routine', 'import_routine', 'import_reference') else self._decorate(db, after)
                response = {'result': result, 'event_id': event['id']}
                db.execute('INSERT INTO commands VALUES(?,?,?)', (request_id, fingerprint, dumps(response)))
                db.commit()
                return response
            except Exception:
                db.rollback()
                raise

    def state(self) -> dict:
        with self.connect() as db:
            db.execute('BEGIN')
            sessions = [self._decorate(db, json.loads(row['body'])) for row in db.execute('SELECT body FROM sessions ORDER BY rowid DESC')]
            routines = [json.loads(row['body']) for row in db.execute('SELECT body FROM routines ORDER BY rowid DESC')]
            references = [json.loads(row['body']) for row in db.execute('SELECT body FROM imported_references ORDER BY rowid')]
            db.commit()
        sessions.sort(key=lambda s: datetime.fromisoformat(s['started_at']), reverse=True)
        finished = [s for s in sessions if s['status'] == 'finished']
        exercise_stats: dict[str, dict[str, Any]] = {}
        for session in finished:
            for s in session['sets']:
                key = s['exercise'].casefold()
                stat = exercise_stats.setdefault(key, {'exercise': s['exercise'], 'sets': 0, 'reps': 0, 'volume_kg': Decimal(0), 'best_load_kg': Decimal(0), 'history': []})
                stat['sets'] += 1
                stat['reps'] += s['reps']
                load = Decimal(s['load_kg'])
                stat['volume_kg'] += load * s['reps']
                stat['best_load_kg'] = max(stat['best_load_kg'], load)
            # Keep exact exercise variants distinct; group only whitespace/case-equivalent names.
            session_exercises = {}
            for entry in session['sets']:
                session_exercises.setdefault(entry['exercise'].casefold(), []).append(entry)
            for exercise_key, entries in session_exercises.items():
                rpes = [Decimal(str(e['rpe'])) for e in entries if e['rpe'] is not None]
                exercise_stats[exercise_key]['history'].append({
                    'session_id': session['id'], 'title': session['title'], 'started_at': session['started_at'], 'sets': entries,
                    'volume_kg': decimal_text(sum((Decimal(e['load_kg']) * e['reps'] for e in entries), Decimal(0))),
                    'total_reps': sum(e['reps'] for e in entries),
                    'best_load_kg': decimal_text(max(Decimal(e['load_kg']) for e in entries)),
                    'mean_rpe': decimal_text(sum(rpes) / len(rpes)) if rpes else None})
        volume = sum((s['volume_kg'] for s in exercise_stats.values()), Decimal(0))
        for stat in exercise_stats.values():
            history = stat['history']
            stat['comparison'] = None
            if len(history) >= 2:
                latest, previous = history[:2]
                stat['comparison'] = {
                    'last_session_id': latest['session_id'], 'previous_session_id': previous['session_id'],
                    'volume_delta_kg': decimal_text(Decimal(latest['volume_kg']) - Decimal(previous['volume_kg'])),
                    'total_reps_delta': latest['total_reps'] - previous['total_reps'],
                    'best_load_delta_kg': decimal_text(Decimal(latest['best_load_kg']) - Decimal(previous['best_load_kg']))}
            stat['volume_kg'] = decimal_text(stat['volume_kg'])
            stat['best_load_kg'] = decimal_text(stat['best_load_kg'])
        return {'imported_references': references, 'active_session': next((s for s in sessions if s['status'] == 'active'), None), 'sessions': sessions, 'routines': routines,
                'summary': {'finished_sessions': len(finished), 'total_sets': sum(len(s['sets']) for s in finished),
                            'volume_kg': decimal_text(volume), 'exercises': sorted(exercise_stats.values(), key=lambda s: s['exercise'].casefold())}}

    def events(self, session_id):
        with self.connect() as db:
            db.execute('BEGIN')
            self._session(db, session_id)
            result = self._events(db, session_id)
            db.commit()
            return result

    def export(self):
        # One transaction ensures exported snapshots and their audit log agree.
        with self.connect() as db:
            db.execute('BEGIN')
            result = {'schema_version': 1, 'exported_at': now(),
                      'sessions': [json.loads(r['body']) for r in db.execute('SELECT body FROM sessions ORDER BY rowid')],
                      'routines': [json.loads(r['body']) for r in db.execute('SELECT body FROM routines ORDER BY rowid')],
                      'events': [json.loads(r['body']) for r in db.execute('SELECT body FROM events ORDER BY sequence')],
                      'imported_references': [json.loads(r['body']) for r in db.execute('SELECT body FROM imported_references ORDER BY rowid')]}
            db.commit()
            return result
