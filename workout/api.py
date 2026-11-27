"""Loopback-only development HTTP adapter. Do not expose this without authentication."""
import csv
import io

from fastapi import FastAPI, Request, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import ROOT, database_path
from .store import DomainError, Store
from .nutrition import NutritionStore, companion_path
from .tracking import TrackingStore
from .food_sources import FoodSources


class BodyLimitMiddleware:
    """Bound real bytes, including chunked requests, before JSON parsing."""
    def __init__(self, app, maximum=65536):
        self.app, self.maximum = app, maximum

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] in ('GET', 'HEAD', 'OPTIONS'):
            return await self.app(scope, receive, send)
        chunks, count = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            count += len(chunk)
            if count > self.maximum:
                response = JSONResponse({'error': {'code': 'body_too_large', 'message': 'Command body is too large.'}}, 413)
                return await response(scope, receive, send)
            chunks.append(chunk)
            if not message.get('more_body', False):
                break
        sent = False
        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {'type': 'http.request', 'body': b''.join(chunks), 'more_body': False}
            return await receive()
        await self.app(scope, replay, send)


class Command(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: StrictStr
    action: StrictStr
    payload: dict
    expected_revision: StrictInt | None = None


def create_app(db_path=None):
    store = Store(db_path or database_path())
    nutrition = NutritionStore(companion_path(db_path or database_path()))
    tracking = TrackingStore(nutrition)
    food_sources = FoodSources()
    app = FastAPI(title='Live Workout', version='0.1.0', docs_url=None, redoc_url=None, openapi_url='/api/openapi.json')
    app.state.store = store
    app.state.nutrition = nutrition
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost', '127.0.0.1', '[::1]', 'testserver'])

    @app.middleware('http')
    async def local_security(request: Request, call_next):
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('origin')
            if origin and origin != str(request.base_url).rstrip('/'):
                return JSONResponse({'error': {'code': 'origin_denied', 'message': 'Cross-origin writes are not allowed.'}}, 403)
            if request.headers.get('sec-fetch-site') == 'cross-site':
                return JSONResponse({'error': {'code': 'origin_denied', 'message': 'Cross-site writes are not allowed.'}}, 403)
            if request.headers.get('content-type', '').split(';')[0] != 'application/json':
                return JSONResponse({'error': {'code': 'json_required', 'message': 'Use application/json.'}}, 415)
            # Bodies are deliberately small; proxy limits are still needed before any deployment.
            try:
                if int(request.headers.get('content-length', '0')) > 65536:
                    return JSONResponse({'error': {'code': 'body_too_large', 'message': 'Command body is too large.'}}, 413)
            except ValueError:
                return JSONResponse({'error': {'code': 'invalid_length', 'message': 'Invalid Content-Length.'}}, 400)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return JSONResponse({'error': exc.as_dict()}, exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({'error': {'code': 'invalid_input', 'message': 'Malformed command or incorrect field types.'}}, 422)

    @app.get('/api/health')
    def health():
        return {'status': 'ok', 'version': '0.1.0', 'mode': 'local-single-user'}

    @app.get('/api/exercises')
    def exercise_names():
        names = {s['exercise'] for workout in store.state()['sessions'] for s in workout['sets']}
        return sorted(names, key=str.casefold)

    @app.get('/api/state')
    def state():
        return store.state()

    @app.post('/api/commands')
    def command(body: Command):
        return store.command(**body.model_dump())

    @app.get('/api/sessions/{session_id}/events')
    def events(session_id: str):
        return {'events': store.events(session_id)}

    @app.get('/api/export.json')
    def export_json():
        return JSONResponse(store.export(), headers={'Content-Disposition': 'attachment; filename="live-workout.json"'})

    @app.get('/api/export.csv')
    def export_csv():
        output = io.StringIO(newline='')
        writer = csv.writer(output)
        writer.writerow(['session_id','title','status','started_at','finished_at','set_id','exercise','load','unit','load_kg','reps','rpe'])
        for session in store.export()['sessions']:
            for entry in session['sets']:
                # Spreadsheet programs may execute formulas even inside quoted CSV cells.
                def safe(value):
                    value = str(value or '')
                    return "'" + value if value.lstrip().startswith(('=', '+', '-', '@', '\t', '\r', '\n')) else value
                writer.writerow([session['id'], safe(session['title']), session['status'], session['started_at'], session['finished_at'],
                                 entry['id'], safe(entry['exercise']), entry['load'], entry['unit'], entry['load_kg'], entry['reps'], entry['rpe']])
        return Response(output.getvalue(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="live-workout.csv"'})

    @app.get('/api/nutrition/state')
    def nutrition_state(day: str, timezone: str = 'America/New_York', page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
        return nutrition.state(day, timezone, page, page_size)

    @app.get('/api/nutrition/history')
    def nutrition_history(start_date: str, end_date: str, timezone: str = 'America/New_York'):
        return nutrition.history(start_date, end_date, timezone)

    @app.get('/api/nutrition/foods/search')
    def nutrition_search(q: str, page: int = Query(1, ge=1, le=100)):
        return food_sources.search(q, page)

    @app.get('/api/nutrition/foods/barcode/{code}')
    def nutrition_barcode(code: str):
        return food_sources.barcode(code)

    @app.post('/api/nutrition/commands')
    def nutrition_command(body: Command):
        return nutrition.command(**body.model_dump())

    @app.get('/api/nutrition/export.json')
    def nutrition_export():
        return JSONResponse({**nutrition.export(), 'tracking':tracking.export()}, headers={'Content-Disposition': 'attachment; filename="setwise-nutrition.json"'})

    @app.get('/api/tracking/state')
    def tracking_state(start_date: str, end_date: str, timezone: str = 'America/New_York'):
        return tracking.state(start_date, end_date, timezone)

    @app.post('/api/tracking/commands')
    def tracking_command(body: Command):
        return tracking.command(**body.model_dump())

    @app.get('/')
    def index():
        return FileResponse(ROOT / 'static' / 'index.html')

    app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')
    return app
