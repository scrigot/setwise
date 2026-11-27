# API / command contract

All writes are `POST /api/commands` with `Content-Type: application/json`:

```json
{
  "request_id": "f561aecc-e5c2-478c-bd5e-502e40f3b6d7",
  "action": "log_set",
  "expected_revision": 0,
  "payload": {
    "session_id": "returned-session-uuid",
    "exercise": "Bench press",
    "load": "100",
    "unit": "lb",
    "reps": 8,
    "rpe": 8.5
  }
}
```

`load` accepts a decimal string or JSON number, 0–2000, at most four decimal places. Strings are preferred by clients. Units must be `kg` or `lb`. Reps are an integer 1–1000. RPE is omitted/null or a number 1–10 in 0.5 increments. Each set receives a stable UUID. User strings are bounded and extra fields rejected.

Supported actions and payloads:

| Action | Payload | Revision |
| --- | --- | --- |
| start_session | title, optional routine_id | omit |
| log_set | session_id, exercise, load, unit, reps, optional rpe | required |
| edit_set | session_id, set_id, exercise, load, unit, reps, optional rpe | required |
| remove_set | session_id, set_id | required |
| undo | session_id | required |
| finish_session | session_id | required |
| save_routine | session_id, name | omit |

Edits replace all the set's user-facing fields, retaining its ID. Omitting RPE on edit clears RPE. Undo reverses the most recent not-already-undone set add/edit/remove; no redo, start/finish undo or routine deletion exists. Starting a saved routine copies its target sets to `plan`, not to completed `sets`.

Success: `{ "result": <session-or-routine>, "event_id": "..." }`.
Error: `{ "error": { "code": "...", "message": "...", "details": {} } }`.

- 400: validation/unknown action; malformed fields have no side effects
- 404: missing session/routine/set
- 409: revision conflict, active session exists, reused idempotency ID with different input, finished session, or nothing to undo
- 422: invalid top-level JSON schema
- 403/415: cross-origin or non-JSON write rejected

For a replay, the original stored result is returned. It can contain an older revision than the latest state; refresh `GET /api/state` after it. A failed command is not recorded as a successful event. Do not retry known validation failures as if they were network uncertainty.

`GET /api/state` returns `{active_session,sessions,routines,summary}`. Sessions are newest first. Summary includes completed sessions only. `summary.exercises[].history` contains per-session sets, volume, reps, best load and observed mean RPE. Its `comparison` is null until two completed sessions for the exact exercise name exist; otherwise it compares the latest two. Original lb/kg values remain on each set; normalized comparison loads/volume are kg/kg-reps. No inference about cause, injury, adaptation or treatment is made.

JSON export is schema version 1 and includes all state and events from a single database read transaction. The generated OpenAPI document describes the transport; this page defines action-specific payloads.

## Completed workout import

`import_session` uses the existing command endpoint and idempotency contract. Omit
`expected_revision`. Required payload fields: `title`, `started_at`, `finished_at`,
`source: {system, id}`, and `sets` (1–500). Optional `notes` retains provenance.
Timestamps must include a timezone and are normalized to UTC; finish cannot precede
start. Each set uses the usual exercise/load/unit/reps/optional rpe fields, plus
optional `rpe_source` (requires non-null RPE) and `set_type` (`normal`, `warmup`, `failure`, or `dropset`).
The command atomically creates one finished, read-only session without changing an
active session. A repeated source system/id with a new request ID is rejected with
`duplicate_source` (409); exact retries with the same request ID return the original
result. Audit `at` records import time separately from workout time. Provenance is
included in JSON export/audit and the session details; CSV retains its existing columns.
Sessions and exercise comparisons are ordered by workout start, not import order.
No schema migration is required; optional metadata is stored in existing JSON bodies.

## Additional source imports

`import_routine`: required `name`, timezone-aware `created_at`, `updated_at`,
`source`, and `sets`; optional `notes`, `source_data`. Creates a routine without
creating a workout. `import_reference`: required `kind`, `source`, `source_data`;
kinds: `preferences`, `exercise_definition`, `routine_folder`, `workout_source`.
Both omit expected_revision, are transactional and idempotent, and reject a
repeated kind/source pair rather than overwrite it. A reference can archive an
original source workout without modifying an already corrected session.

Routine imports may use `load: null` for a weight/reps target whose starting weight
has not been prescribed. This stores an explicit `load_unset: true` marker and
`source_load: null`; numeric zero fields are internal placeholders only. The UI
shows "Choose weight" and leaves the logging form's required weight input blank.
Completed-session imports and logged sets still require a numeric weight. Routine
RPE fields are optional; use notes for effort ranges so targets are not logged as
observed effort.

Imports may retain the complete source object in `source_data` (max 60000 bytes).
Imported sets additionally support exercise_template_id, notes, rest_seconds,
superset_id, and exercise_type (`weight_reps` or `reps_only`). Reps-only input load
must be null: a zero internal volume placeholder and explicit source_load=null
are retained, and the UI displays reps without claiming a recorded zero weight.
Other exercise metrics are not supported by the logging UI; source_data keeps
raw fields, including nulls, source timestamps, and source weights.

Imported references are returned by state and JSON export. Preferences default a
new empty browser draft to the source weight unit; existing drafts are respected.
Distance preference and definition metadata are retained for reference; Setwise
has no distance logging or exercise-definition editor. CSV retains its old
columns and cannot represent all metadata; use JSON for a full export.

The additive imported_references table is created automatically alongside the
existing schema-1 tables, without rewriting sessions, routines, or audit records.
Back up the database before upgrading an existing installation.

## Nutrition journal

See [nutrition API, schemas and chat tools](NUTRITION.md) for the additive nutrition routes. These write a separate companion database and do not change workout commands or records.
