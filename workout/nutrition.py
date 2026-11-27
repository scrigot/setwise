"""Local nutrition journal. Nutrient snapshots never depend on a changing food catalog."""
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .store import DomainError, decimal_text, dumps, fields, import_timestamp, now, text_field

NUTRIENTS = ('kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g')
BASES = {'per_100g': ('g', Decimal(100)), 'per_100ml': ('ml', Decimal(100)), 'per_serving': ('serving', Decimal(1))}
SOURCE_KINDS = {'usda', 'open_food_facts', 'label', 'restaurant_pdf', 'manual', 'estimate', 'recipe'}


def companion_path(workout_path):
    """Every workout database (including test copies) gets its own companion journal."""
    path = Path(workout_path)
    return path.with_name(path.stem + '-nutrition.sqlite3')


def amount(value, name, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (str, int, float)) or len(str(value)) > 24:
        raise DomainError('invalid_input', f'{name} must be a finite decimal number.')
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise DomainError('invalid_input', f'{name} must be a finite decimal number.')
    if not result.is_finite() or result < 0 or result > 100000 or (positive and result == 0):
        raise DomainError('invalid_input', f'{name} must be {"positive" if positive else "nonnegative"} and at most 100000.')
    if result.as_tuple().exponent < -6:
        raise DomainError('invalid_input', f'{name} supports at most six decimal places.')
    return result


def optional_text(value, name, maximum=2000):
    return '' if value in (None, '') else text_field(value, name, maximum)


def validate_source(value):
    fields(value, {'kind', 'id', 'url', 'page', 'retrieved_at', 'notes'}, {'kind'})
    if not isinstance(value['kind'], str) or value['kind'] not in SOURCE_KINDS:
        raise DomainError('invalid_input', 'Choose a supported food source kind.')
    source = {'kind': value['kind']}
    for key, maximum in [('id', 150), ('notes', 2000), ('page', 100)]:
        if value.get(key) is not None:
            source[key] = optional_text(value[key], 'source.' + key, maximum)
    if value.get('url'):
        url = text_field(value['url'], 'source.url', 2000)
        try:
            parsed = urlsplit(url)
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError()
        except ValueError:
            raise DomainError('invalid_input', 'Source URL must be an http(s) URL without credentials.')
        source['url'] = url  # Evidence only; never fetched by this module.
    if value.get('retrieved_at'):
        source['retrieved_at'] = import_timestamp(value['retrieved_at'], 'source.retrieved_at')
    return source


def validate_food(value):
    fields(value, {'name', 'basis', 'nutrients', 'source', 'serving_description', 'ingredients', 'notes'}, {'name', 'basis', 'nutrients', 'source'})
    basis = value['basis']
    if not isinstance(basis, str) or basis not in BASES:
        raise DomainError('invalid_input', 'basis must be per_100g, per_100ml or per_serving.')
    fields(value['nutrients'], set(NUTRIENTS), set())
    nutrients = {key: None if value['nutrients'].get(key) is None else decimal_text(amount(value['nutrients'][key], key)) for key in NUTRIENTS}
    if all(v is None for v in nutrients.values()):
        raise DomainError('invalid_input', 'Supply at least one nutrient; leave unknown values null.')
    return {'name': text_field(value['name'], 'food name', 200), 'basis': basis, 'nutrients': nutrients,
            'source': validate_source(value['source']), 'serving_description': optional_text(value.get('serving_description'), 'serving description', 300),
            'ingredients': optional_text(value.get('ingredients'), 'ingredients', 5000), 'notes': optional_text(value.get('notes'), 'food notes')}


def validate_item(value):
    fields(value, {'food', 'quantity', 'quantity_unit', 'estimated', 'portion_method', 'notes'}, {'food', 'quantity', 'quantity_unit', 'estimated', 'portion_method'})
    food = validate_food(value['food'])
    unit, divisor = BASES[food['basis']]
    if value['quantity_unit'] != unit:
        raise DomainError('invalid_unit', f'{food["basis"]} requires {unit}. Supply an explicit conversion rather than assuming mass equals volume.')
    if type(value['estimated']) is not bool:
        raise DomainError('invalid_input', 'estimated must be true or false.')
    method = value['portion_method']
    if method not in ('weighed', 'label_serving', 'user_report', 'photo_estimate', 'recipe_estimate'):
        raise DomainError('invalid_input', 'Choose an explicit portion_method.')
    estimated = value['estimated'] or method in ('photo_estimate', 'recipe_estimate') or food['source']['kind'] == 'estimate'
    quantity = amount(value['quantity'], 'quantity', positive=True)
    totals = {key: None if val is None else decimal_text((Decimal(val) * quantity / divisor).quantize(Decimal('.000001'))) for key, val in food['nutrients'].items()}
    return {'food': food, 'quantity': decimal_text(quantity), 'quantity_unit': unit, 'estimated': estimated,
            'portion_method': method, 'notes': optional_text(value.get('notes'), 'portion notes'), 'totals': totals}


def summarize(items):
    return {key: {'known': decimal_text(sum((Decimal(item['totals'][key]) for item in items if item['totals'][key] is not None), Decimal(0))),
                  'missing_items': sum(item['totals'][key] is None for item in items)} for key in NUTRIENTS}


def validate_meal(payload):
    fields(payload, {'title', 'occurred_at', 'status', 'items', 'notes', 'evidence'}, {'title', 'occurred_at', 'status', 'items'})
    if payload['status'] not in ('draft', 'logged'):
        raise DomainError('invalid_input', 'Meal status must be draft or logged.')
    if not isinstance(payload['items'], list) or not 1 <= len(payload['items']) <= 50:
        raise DomainError('invalid_input', 'A meal needs 1–50 items.')
    items = [validate_item(item) for item in payload['items']]
    return {'title': text_field(payload['title'], 'meal title', 200), 'occurred_at': import_timestamp(payload['occurred_at'], 'occurred_at'),
            'status': payload['status'], 'items': items, 'notes': optional_text(payload.get('notes'), 'meal notes'),
            'evidence': optional_text(payload.get('evidence'), 'photo/PDF evidence', 4000), 'totals': summarize(items),
            'estimated': any(item['estimated'] for item in items)}


def calendar_range(start_date, end_date, timezone):
    try:
        start, end, zone = date.fromisoformat(start_date), date.fromisoformat(end_date), ZoneInfo(timezone)
        if start > end or (end - start).days > 365:
            raise ValueError()
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        raise DomainError('invalid_input', 'Use ISO dates, a valid IANA timezone, and a range of at most 366 days.')
    return start, end, zone


class NutritionStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            if db.execute("SELECT name FROM sqlite_master WHERE name='nutrition_meta'").fetchone():
                versions = [row[0] for row in db.execute('SELECT version FROM nutrition_meta')]
                if versions != [1]:
                    raise DomainError('schema_mismatch', 'Unsupported nutrition database version.', 500)
            db.executescript('''
                CREATE TABLE IF NOT EXISTS nutrition_meta(version INTEGER NOT NULL);
                INSERT INTO nutrition_meta SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM nutrition_meta);
                CREATE TABLE IF NOT EXISTS meals(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS foods(id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS nutrition_commands(request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS nutrition_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, action TEXT NOT NULL, entity_id TEXT NOT NULL, before_data TEXT, after_data TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS nutrition_events_no_update BEFORE UPDATE ON nutrition_events BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
                CREATE TRIGGER IF NOT EXISTS nutrition_events_no_delete BEFORE DELETE ON nutrition_events BEGIN SELECT RAISE(ABORT,'Append-only audit'); END;
            ''')
            if db.execute('SELECT version FROM nutrition_meta').fetchone()[0] != 1:
                raise DomainError('schema_mismatch', 'Unsupported nutrition database version.', 500)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA synchronous=FULL')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def command(self, request_id, action, payload, expected_revision=None):
        request_id = text_field(request_id, 'request_id', 128)
        if action not in ('log_meal', 'edit_meal', 'delete_meal', 'restore_meal', 'save_food'):
            raise DomainError('unknown_action', 'Unknown nutrition action.')
        if expected_revision is not None and (type(expected_revision) is not int or expected_revision < 0):
            raise DomainError('invalid_input', 'expected_revision must be a nonnegative integer.')
        try:
            fingerprint = hashlib.sha256(dumps([action, payload, expected_revision]).encode()).hexdigest()
        except (ValueError, TypeError):
            raise DomainError('invalid_input', 'Command must contain valid JSON values.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM nutrition_commands WHERE request_id=?', (request_id,)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise DomainError('idempotency_conflict', 'This request_id was already used with different arguments.', 409)
                return json.loads(previous['response'])
            before = None
            if action == 'save_food':
                fields(payload, {'food'}, {'food'})
                result = {'id': str(uuid4()), **validate_food(payload['food']), 'created_at': now()}
                table = 'foods'
            elif action == 'log_meal':
                if expected_revision is not None:
                    raise DomainError('invalid_input', 'A new meal has no expected revision.')
                result = {'id': str(uuid4()), **validate_meal(payload), 'revision': 0, 'created_at': now(), 'updated_at': now(), 'deleted': False}
                table = 'meals'
            else:
                fields(payload, {'meal_id', 'meal'} if action == 'edit_meal' else {'meal_id'}, {'meal_id', 'meal'} if action == 'edit_meal' else {'meal_id'})
                meal_id = text_field(payload['meal_id'], 'meal_id', 128)
                row = db.execute('SELECT data FROM meals WHERE id=?', (meal_id,)).fetchone()
                if not row:
                    raise DomainError('not_found', 'Meal does not exist.', 404)
                before = json.loads(row['data'])
                if expected_revision is None or before['revision'] != expected_revision:
                    raise DomainError('revision_conflict', 'Meal changed. Read its current revision before correcting it.', 409)
                if action == 'edit_meal' and before['deleted']:
                    raise DomainError('meal_deleted', 'Restore this meal before editing it.', 409)
                result = {**before}
                if action == 'edit_meal':
                    result.update(validate_meal(payload['meal']))
                else:
                    result['deleted'] = action == 'delete_meal'
                result.update(revision=before['revision'] + 1, updated_at=now())
                table = 'meals'
            db.execute(f'INSERT OR REPLACE INTO {table}(id,data) VALUES(?,?)', (result['id'], dumps(result)))
            cursor = db.execute('INSERT INTO nutrition_events(at,request_id,action,entity_id,before_data,after_data) VALUES(?,?,?,?,?,?)',
                                (now(), request_id, action, result['id'], dumps(before) if before else None, dumps(result)))
            response = {'result': result, 'event_id': cursor.lastrowid}
            db.execute('INSERT INTO nutrition_commands VALUES(?,?,?)', (request_id, fingerprint, dumps(response)))
            return response

    def _meals(self, db):
        return sorted((json.loads(row[0]) for row in db.execute('SELECT data FROM meals')), key=lambda meal: (meal['occurred_at'], meal['id']), reverse=True)

    def state(self, day, timezone='America/New_York', page=1, page_size=50):
        start, _, zone = calendar_range(day, day, timezone)
        if type(page) is not int or type(page_size) is not int or page < 1 or not 1 <= page_size <= 100:
            raise DomainError('invalid_input', 'Use page >= 1 and page_size 1–100.')
        with self.connect() as db:
            db.execute('BEGIN')
            meals = [meal for meal in self._meals(db) if datetime.fromisoformat(meal['occurred_at']).astimezone(zone).date() == start]
            foods = [json.loads(row[0]) for row in db.execute('SELECT data FROM foods ORDER BY rowid DESC LIMIT 100')]
        logged = [m for m in meals if not m['deleted'] and m['status'] == 'logged']
        items = [item for meal in logged for item in meal['items']]
        return {'day': day, 'timezone': timezone, 'meals': meals[(page-1)*page_size:page*page_size], 'meal_count': len(meals),
                'logged_meals': len(logged), 'estimated_meals': sum(m['estimated'] for m in logged), 'totals': summarize(items),
                'page': page, 'page_size': page_size, 'has_more': page*page_size < len(meals), 'foods': foods,
                'coverage': 'unlogged' if not logged else 'recorded_items_only'}

    def history(self, start_date, end_date, timezone='America/New_York'):
        start, end, zone = calendar_range(start_date, end_date, timezone)
        with self.connect() as db:
            db.execute('BEGIN')
            grouped = {}
            for meal in self._meals(db):
                day = datetime.fromisoformat(meal['occurred_at']).astimezone(zone).date()
                if start <= day <= end and not meal['deleted'] and meal['status'] == 'logged':
                    grouped.setdefault(day, []).append(meal)
        result = []
        while start <= end:
            meals = grouped.get(start, [])
            result.append({'day': start.isoformat(), 'logged_meals': len(meals), 'estimated_meals': sum(m['estimated'] for m in meals),
                           'totals': summarize([item for meal in meals for item in meal['items']]), 'coverage': 'recorded_items_only' if meals else 'unlogged'})
            if start == end:
                break
            start += timedelta(days=1)
        return {'timezone': timezone, 'days': result}

    def export(self):
        with self.connect() as db:
            db.execute('BEGIN')
            return {'schema_version': 1, 'exported_at': now(), 'meals': self._meals(db),
                    'foods': [json.loads(row[0]) for row in db.execute('SELECT data FROM foods')],
                    'events': [{**dict(row), 'before_data': json.loads(row['before_data']) if row['before_data'] else None,
                                'after_data': json.loads(row['after_data'])} for row in db.execute('SELECT * FROM nutrition_events ORDER BY seq')]}
