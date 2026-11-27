# Setwise — local-first workout and nutrition journal

Setwise is the working UI name for this small, local-first workout log you can control through a mobile-friendly web interface or a local MCP client. The UI and MCP tools share one deterministic command layer and one SQLite database. No LLM API, paid service, account or API key is needed for core logging.

**Status: single-user MVP.** The Python web API is local-only and has no user authentication. The optional mobile history reader is for a private Tailscale network with an explicit device allowlist; it is not an internet-facing service. Native iPhone/Android acceptance remains unverified.

Built by [Sam Rigot](https://github.com/scrigot). This repository contains application source and synthetic tests; personal journals, exports, device configuration and screenshots stay local. See [security and privacy](SECURITY.md) and [contributing](CONTRIBUTING.md).

## Native mobile history

The new Expo / React Native app is in [`mobile/`](mobile/README.md). It provides a Spotify-inspired history screen for iPhone and Android, including gym labels for completed workouts. The phone reads completed sessions from the live MCP journal through a private Tailscale history reader. See the mobile README for launch and verification instructions.

## Run locally

Python 3.12 is tested. Node.js 22+ is only needed for the frontend logic tests, not to run the app. From the project folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m workout
```

Open http://127.0.0.1:8765 on the **same computer**. On Windows, activate with `.venv\Scripts\activate` instead. Dependencies are pinned to the versions tested in the build environment; this is not a fully locked transitive dependency set.

Default workout database: `data/workouts.sqlite3` (nutrition uses the separate companion `data/workouts-nutrition.sqlite3`), resolved relative to this project, not your shell's current directory. It starts empty. Override with `WORKOUT_DB=/absolute/path/workouts.sqlite3` or `python -m workout --db /absolute/path/workouts.sqlite3 --port 8765`.

## What works

- Start a named session, optionally from a saved routine
- Log sets with exercise, decimal load, explicit kg/lb, whole-number reps and optional RPE
- Correct a set, remove it, or undo the latest remaining set change while the session is active
- Finish a session, view history, save completed sets as a reusable routine
- See completed-session exercise history and latest-versus-previous load, reps and volume; RPE is retained
- JSON export of sessions, routines and full audit history; CSV export of the current set records
- Mobile-friendly interface and local pending-set queue with visible sync/conflict state
- Twenty local MCP tools: ten workout tools plus ten nutrition journal and food lookup tools
- Nutrition tab with meals, calorie/macronutrient totals, USDA search, barcode lookup, source notes, drafts and recoverable corrections/removal
- Chat can interpret food photos and official nutrition PDFs, then save structured estimates through the nutrition tools; see [Nutrition guide](docs/NUTRITION.md)

Only whitespace and case are normalized in exercise identity. `Bench press` and `Larsen press` stay different. Deliberately use precise names for distinct equipment/variants. Volume is a load-times-reps bookkeeping metric; a higher value does not by itself prove improved strength or health. Bodyweight exercise loads are external load only; zero is allowed and body mass is not inferred.

## Reliability contract

Every mutation needs a unique `request_id`. After an uncertain network response, retry **the exact same ID and arguments**. The command, result, event and state update commit in one SQLite transaction. Repeating a committed command returns its original response, even after newer changes. Reusing its ID for different arguments returns `idempotency_conflict`.

Session changes also need `expected_revision`. Concurrent clients cannot silently overwrite each other: stale writes return `revision_conflict`. Refresh, review the current session, and deliberately submit a new command after a conflict. Do not mechanically replace the revision and retry a correction.

The original load/unit are stored alongside exact decimal kg conversion: `1 lb = 0.45359237 kg`. Display rounding never changes the source. An append-only event trail retains before/after snapshots and undo references. Database triggers prevent ordinary event updates/deletes; it is **not** a cryptographically tamper-proof log against someone who controls the SQLite file.

SQLite uses WAL, FULL synchronous writes and a transactional single-active-session constraint. The current schema favors small, transparent personal datasets over scalability. It is not a multi-user service.

## Offline behavior

The web interface retains pending set additions in this browser's local storage. A pending set is visibly separate from server-saved sets. Retries retain the original idempotency key. If another client has changed the workout, syncing stops for explicit review rather than overwriting it.

This is **not a complete offline-installed PWA**. There is no service worker/app-shell cache, background sync or cross-device queue. Keep the already loaded page open when the connection drops. Pending records survive an ordinary reload, but the shell still needs the server to load. Clearing browser storage, private-browsing restrictions, storage eviction or switching browsers can lose unsynced data. Local storage and SQLite are unencrypted. Browsers with Web Locks allow one writing tab per origin. Other browsers only detect storage changes after the fact; use one logging tab per browser.

Start, edit, undo, finish and routine creation need a working connection. A request with an uncertain outcome is kept for an exact retry. You must resolve pending writes before finishing. Finished sessions are read-only in this MVP; review and correct your sets before finishing.

## Local MCP

Launch the stdio adapter from the project root:

```sh
WORKOUT_DB=/absolute/path/workouts.sqlite3 python -m workout.mcp_server
```

Use the **same absolute database path** as the web app. A compatible local MCP client can launch it with configuration similar to:

```json
{
  "mcpServers": {
    "live-workout": {
      "command": "/absolute/path/live-workout-mvp/.venv/bin/python",
      "args": ["-m", "workout.mcp_server"],
      "cwd": "/absolute/path/live-workout-mvp",
      "env": {"WORKOUT_DB": "/absolute/path/workouts.sqlite3"}
    }
  }
}
```

Client configuration formats vary; this is a reference, not an automatically installed integration. For a client without `cwd` support, set `PYTHONPATH` to the project directory in `env`. The adapter uses the tested Python MCP SDK 1.29.0; remote Streamable HTTP, OAuth and hosted connectors are not implemented. Private connector deployments require their own access controls and are not included in this repository.

Read `workout_state`, then use stable session/set IDs and the current revision. The tools ask a model to resolve ambiguous units or exercises, never guess a weight unit, and only make changes requested by the user. These are model-facing instructions, not a substitute for client approval controls.

## HTTP surface

- `GET /api/health`
- `GET /api/state`
- `POST /api/commands`
- `GET /api/sessions/{id}/events`
- `GET /api/export.json`
- `GET /api/export.csv`
- `GET /api/openapi.json`

See [API examples](docs/API.md), [architecture](docs/ARCHITECTURE.md), [roadmap and integrations](docs/ROADMAP.md), and [verification notes](docs/VERIFICATION.md).

## Test

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
node --test tests/test_frontend.mjs tests/test_nutrition_frontend.mjs tests/test_tracking_frontend.mjs
```

The Python suite uses temporary databases and includes a real MCP stdio handshake/tool invocation. It never uses your workout database. Any browser-test fixtures are synthetic. The browser QA limitations and exact verification status are recorded separately; passing backend tests does not establish iPhone compatibility.

## Data safety and backups

Workout records and exports are personal information. Store the project/database on a private device and protect downloads. This app deliberately binds to loopback and rejects unrecognized Host headers/cross-origin writes, but it provides no user authentication, encryption, remote authorization or rate limiting. Don't use a public tunnel or change the bind address until those are designed and reviewed.

Use JSON/CSV exports for portability. JSON includes historical values that you removed or corrected; CSV contains current set records only, without routines/audit or empty sessions. There is no import/restore UI yet. For a full SQLite backup, stop both the web and MCP processes before copying the database, or use SQLite's online backup API. Do not copy only the main `.sqlite3` file while a WAL writer is active.

## License and reference projects

MIT. The implementation here is newly authored; no competitor source code was copied. [FullFran/training-mcp](https://github.com/FullFran/training-mcp) (MIT) was reviewed for its shared-domain architecture. [wger's MCP server](https://github.com/wger-project/mcp-server) (AGPL-3.0) was reviewed as a feature reference, not incorporated. Their licenses remain independent. See [references](docs/REFERENCES.md).
