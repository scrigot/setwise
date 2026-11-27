# Bodyweight and creatine

The Nutrition page includes dated bodyweight and creatine records. Bodyweight requires an explicit lb/kg value. Creatine records that it was taken; grams may be unknown (null). These entries never change calorie or protein totals. Dates have an explicit IANA timezone; exact timestamps stay null unless supplied. `created_at` is audit time, not measurement time.

The seven-day weight average uses available daily measurements, converting lb to kg exactly. The UI reports the number of recorded days. Missing weights are not interpolated. Missing creatine entries mean unknown rather than missed doses. One entry is allowed per kind/date/timezone, with revision-checked corrections, recoverable removal/restore, stable request IDs for retries and an append-only audit.

Storage adds `tracking_entries`, `tracking_commands` and `tracking_events` to the existing nutrition SQLite file. Before installing, use the SQLite online backup API; preserve all existing meal/workout data. Export nutrition in the web UI includes a `tracking` object with entries and audit events.

HTTP: `GET /api/tracking/state?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD&timezone=America/New_York` (max 366 days), `POST /api/tracking/commands` with `{request_id,action,payload,expected_revision?}`. Actions: `save_entry`, `remove_entry`, `restore_entry`. Payload: `{day,timezone,kind:bodyweight|creatine,value?,unit?,notes?,occurred_at?}`. Remove/restore accept only day, timezone, kind. New entries omit expected_revision; existing entries require the current revision. New save_entry values: weight positive lb/kg; creatine positive grams or null dose. A creatine record means taken, never a recommendation.

The private MCP server registers `tracking_state`, `tracking_save_entry`, and `tracking_set_removed` against the explicitly selected nutrition journal. An already-running tunnel child must be restarted and the plugin's tool catalog refreshed before those new tools are available. Workout tools keep their existing database configuration. Do not change credentials or public exposure to enable tracking.
