"""Exercise the actual CLI + TCP listener, in one local process namespace."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import Request, build_opener, ProxyHandler
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent


class RuntimeTests(unittest.TestCase):
    def test_cli_server_serves_ui_and_persists_requests(self):
        with tempfile.TemporaryDirectory() as temp:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            process = subprocess.Popen([sys.executable, '-m', 'workout', '--db', temp + '/runtime.sqlite3', '--port', str(port)],
                                       cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            client = build_opener(ProxyHandler({}))
            base = f'http://127.0.0.1:{port}'
            try:
                deadline = time.monotonic() + 10
                while True:
                    try:
                        response = client.open(base + '/api/health', timeout=1)
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic() > deadline:
                            self.fail('Local HTTP listener did not start')
                        time.sleep(0.05)
                self.assertEqual(json.load(response)['status'], 'ok')
                self.assertIn('Setwise', client.open(base + '/').read().decode())
                self.assertIn('syncQueue', client.open(base + '/static/app.js').read().decode())
                payload = json.dumps({'request_id': str(uuid4()), 'action': 'start_session', 'payload': {'title': 'Runtime test'}}).encode()
                request = Request(base + '/api/commands', data=payload, headers={'Content-Type': 'application/json'})
                saved = json.load(client.open(request))
                self.assertEqual(saved['result']['status'], 'active')
                self.assertEqual(json.load(client.open(base + '/api/state'))['active_session']['id'], saved['result']['id'])
            finally:
                process.terminate()
                process.communicate(timeout=10)


if __name__ == '__main__':
    unittest.main()
