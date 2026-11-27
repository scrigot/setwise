"""Private device reader for the same state service used by the Setwise journal."""
import ipaddress
import json
import sqlite3
import os
import mimetypes
from pathlib import Path
from urllib.parse import unquote, urlsplit
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen

ADDRESS = os.environ["HISTORY_BIND"]
DEVICES = set(os.environ["HISTORY_DEVICES"].split(","))
ORIGINS = {"http://localhost:8081", "http://127.0.0.1:8081"}
ORIGINS.add(f"http://{ADDRESS}:8795")
SITE = Path(__file__).resolve().parent / "site"
if ipaddress.ip_address(ADDRESS) not in ipaddress.ip_network("100.64.0.0/10"):
    raise ValueError("Bind the reader to the server's Tailscale IPv4 address")

GYMS = {gym.strip() for gym in os.environ.get("HISTORY_GYMS", "Home gym|Local gym").split("|") if gym.strip()}
LOCATION_DB = Path(__file__).resolve().parent / "gym-locations.sqlite3"


def finished_sessions():
    with urlopen("http://127.0.0.1:8765/api/state", timeout=8) as response:
        return [s for s in json.load(response)["sessions"] if s["status"] == "finished"]


class Handler(BaseHTTPRequestHandler):
    def allowed(self):
        origin = self.headers.get("Origin")
        return (self.client_address[0] in DEVICES and
                self.headers.get("Host") == f"{ADDRESS}:8795" and
                (not origin or origin in ORIGINS))

    def end_headers(self):
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        super().end_headers()

    def do_OPTIONS(self):
        if not self.allowed() or self.path != "/history/gym":
            return self.send_error(403)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        if not self.allowed():
            return self.send_error(403)
        if self.path != "/history/gym":
            return self.send_error(404)
        if self.headers.get_content_type() != "application/json":
            return self.send_error(415)
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 2048:
                return self.send_error(400)
            payload = json.loads(self.rfile.read(size))
            sid, gym = payload["id"], payload["gym"]
            if not isinstance(sid, str) or gym not in GYMS:
                return self.send_error(400)
        except (KeyError, TypeError, ValueError):
            return self.send_error(400)
        try:
            if not any(s["id"] == sid for s in finished_sessions()):
                return self.send_error(404)
            with sqlite3.connect(LOCATION_DB) as db:
                db.execute("INSERT OR REPLACE INTO locations VALUES (?, ?)", (sid, gym))
        except (OSError, KeyError, ValueError, sqlite3.Error):
            return self.send_error(503)
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return self.send_error(403)
        path = unquote(urlsplit(self.path).path)
        if path != "/history":
            return self.send_asset(path)
        try:
            finished = finished_sessions()
            with sqlite3.connect(LOCATION_DB) as db:
                locations = dict(db.execute("SELECT id, gym FROM locations"))
            fields = ("id", "title", "status", "sets", "started_at", "finished_at",
                      "workout_date", "workout_timezone", "date_precision", "notes")
            sessions = [{k: s[k] for k in fields if k in s}
                        for s in finished]
            for session in sessions:
                if session["id"] in locations:
                    session["gym"] = locations[session["id"]]
            with urlopen("http://127.0.0.1:8765/api/exercises", timeout=8) as response:
                exercise_names = json.load(response)
            body = json.dumps({"exerciseNames": exercise_names, "source": "Setwise", "syncedAt": datetime.now(timezone.utc).isoformat(),
                               "sessions": sessions}).encode()
        except (OSError, ValueError, KeyError, TypeError):
            return self.send_error(503)
        self.send_response(200)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_asset(self, path):
        relative = "index.html" if path == "/" else path.lstrip("/")
        root = SITE.resolve()
        asset = (root / relative).resolve()
        if not asset.is_relative_to(root) or not asset.is_file():
            return self.send_error(404)
        body = asset.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(asset.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    with sqlite3.connect(LOCATION_DB) as db:
        db.execute("CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, gym TEXT NOT NULL)")
    ThreadingHTTPServer((ADDRESS, 8795), Handler).serve_forever()
