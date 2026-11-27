import json
import tempfile
import unittest
from pathlib import Path

from workout.mcp_server import create_server


class SessionTimes(unittest.IsolatedAsyncioTestCase):
    async def test_timestamped_mcp_workout(self):
        with tempfile.TemporaryDirectory() as directory:
            server = create_server(str(Path(directory) / 'times.sqlite3'))
            tools = {tool.name: tool.inputSchema for tool in await server.list_tools()}
            self.assertIn('started_at', tools['start_session']['properties'])
            self.assertIn('finished_at', tools['finish_session']['properties'])
            async def call(name, arguments):
                result = await server.call_tool(name, arguments)
                return json.loads(result[0].text)

            start = {'request_id': 'test-time-start', 'title': 'Test', 'started_at': '2026-11-26T18:20:00-05:00'}
            with self.assertRaisesRegex(Exception, 'invalid_timestamp'):
                await server.call_tool('start_session', {**start, 'started_at': '2026-11-26T18:20'})
            data = await call('start_session', start)
            session = data['result']
            self.assertEqual(session['started_at'], '2026-11-26T23:20:00+00:00')
            end = {'request_id': 'test-time-finish', 'session_id': session['id'], 'expected_revision': 0,
                   'finished_at': '2026-11-26T19:05:00-05:00'}
            with self.assertRaisesRegex(Exception, 'invalid_timestamp'):
                await server.call_tool('finish_session', {**end, 'finished_at': '2026-11-26T18:05:00-05:00'})
            finished = await call('finish_session', end)
            self.assertEqual(finished['result']['finished_at'], '2026-11-27T00:05:00+00:00')
            self.assertEqual(await call('finish_session', end), finished)
