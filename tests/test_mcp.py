import os
from pathlib import Path
import sys
import tempfile
import unittest
from uuid import uuid4
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from workout.store import Store

ROOT = Path(__file__).resolve().parent.parent


class MCPTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stdio_tools_share_store_and_reject_conflicts(self):
        with tempfile.TemporaryDirectory() as temp:
            db = str(Path(temp) / 'mcp.sqlite3')
            params = StdioServerParameters(command=sys.executable, args=['-m', 'workout.mcp_server'],
                                           cwd=str(ROOT), env={**os.environ, 'WORKOUT_DB': db})
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as client:
                    await client.initialize()
                    names = {t.name for t in (await client.list_tools()).tools}
                    self.assertEqual(len(names), 23)
                    self.assertIn('tracking_state', names)
                    self.assertIn('nutrition_log_meal', names)
                    self.assertIn('nutrition_search_foods', names)
                    result = await client.call_tool('start_session', {'request_id': str(uuid4()), 'title': 'MCP synthetic workout'})
                    self.assertFalse(result.isError)
                    session = Store(db).state()['active_session']
                    request = {'request_id': str(uuid4()), 'session_id': session['id'], 'expected_revision': 0,
                               'exercise': 'Row', 'load': '40', 'unit': 'lb', 'reps': 10}
                    for field in ('expected_revision', 'reps', 'rpe'):
                        bad = {**request, field: True}
                        rejected = await client.call_tool('log_set', bad)
                        self.assertTrue(rejected.isError, field)
                    self.assertEqual(Store(db).state()['active_session']['sets'], [])
                    saved = await client.call_tool('log_set', request)
                    self.assertFalse(saved.isError)
                    retry = await client.call_tool('log_set', request)
                    self.assertFalse(retry.isError)
                    self.assertEqual(len(Store(db).state()['active_session']['sets']), 1)
                    stale = await client.call_tool('finish_session', {'request_id': str(uuid4()), 'session_id': session['id'], 'expected_revision': 0})
                    self.assertTrue(stale.isError)
                    state = await client.call_tool('workout_state', {})
                    self.assertFalse(state.isError)
                    exported = await client.call_tool('export_workouts', {})
                    self.assertFalse(exported.isError)
                    nutrition_request = {'request_id': str(uuid4()), 'title': 'Synthetic MCP meal', 'occurred_at': '2026-10-19T12:00:00-04:00',
                        'items': [{'food': {'name': 'Test label', 'basis': 'per_serving', 'nutrients': {'kcal': '200', 'protein_g': '20'}, 'source': {'kind': 'label'}},
                                   'quantity': '2', 'quantity_unit': 'serving', 'estimated': False, 'portion_method': 'label_serving'}]}
                    for _ in range(2):
                        saved_meal = await client.call_tool('nutrition_log_meal', nutrition_request)
                        self.assertFalse(saved_meal.isError)
                    from workout.nutrition import NutritionStore, companion_path
                    nutrition = NutritionStore(companion_path(db))
                    self.assertEqual(nutrition.state('2026-10-19')['logged_meals'], 1)
                    self.assertEqual(nutrition.state('2026-10-19')['totals']['kcal']['known'], '400')
                    self.assertEqual(len(Store(db).state()['active_session']['sets']), 1)
                    self.assertFalse((await client.call_tool('nutrition_export', {})).isError)
                    tracking_request = {'request_id':str(uuid4()),'day':'2026-10-19','timezone':'America/New_York','kind':'creatine','unit':'g','value':None}
                    for _ in range(2):
                        self.assertFalse((await client.call_tool('tracking_save_entry',tracking_request)).isError)
                    from workout.tracking import TrackingStore
                    self.assertEqual(len(TrackingStore(nutrition).export()['entries']),1)
                    self.assertEqual(nutrition.state('2026-10-19')['totals']['kcal']['known'],'400')


if __name__ == '__main__':
    unittest.main()
