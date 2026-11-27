"""Local stdio MCP adapter. Uses exactly the same Store as the web UI."""
from typing import Literal
from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import StrictFloat, StrictInt
from .config import database_path
from .store import DomainError, Store
from .nutrition import NutritionStore, companion_path
from .food_sources import FoodSources
from .nutrition_mcp import INSTRUCTIONS, register_nutrition
from .tracking import TrackingStore
from .tracking_mcp import register_tracking

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)


def create_server(db_path=None, nutrition_db_path=None):
    store = Store(db_path or database_path())
    mcp = FastMCP('Live Workout', instructions=(
        'Read workout_state before changes. Ask the user to resolve ambiguous load, unit, exercise or reps. '
        'Never infer kg versus lb. For each intended mutation generate a unique request_id (UUID recommended); '
        'retry an uncertain request with exactly the same request_id and arguments. Use the current session '
        'revision as expected_revision. On revision_conflict, refresh and ask the user to review before submitting '
        'a new request. Describe pending versus saved accurately. Finished sessions are read-only. '
        'No coaching or autonomous changes. Only mutate workouts when requested by the user.' + INSTRUCTIONS))

    def execute(request_id, action, payload, expected_revision=None):
        try:
            return store.command(request_id, action, payload, expected_revision)
        except DomainError as exc:
            # Raising produces an MCP isError response; never masquerade as a successful save.
            raise ValueError(f'{exc.code}: {exc.message}; details={exc.details}') from exc

    @mcp.tool(annotations=READ)
    def workout_state() -> dict:
        """Read active session, stable set IDs, revisions, routines, history and finished-session statistics."""
        return store.state()

    @mcp.tool(annotations=WRITE)
    def start_session(request_id: str, title: str, routine_id: str | None = None, started_at: str | None = None) -> dict:
        """Start one active workout, optionally copying a saved routine's target sets. Never logs target sets as completed. Optional started_at is the actual ISO 8601 start time with UTC offset. Omit to start now."""
        payload = {'title': title}
        if started_at is not None:
            payload['started_at'] = started_at
        if routine_id is not None:
            payload['routine_id'] = routine_id
        return execute(request_id, 'start_session', payload)

    @mcp.tool(annotations=WRITE)
    def log_set(request_id: str, session_id: str, expected_revision: StrictInt, exercise: str, load: str,
                unit: Literal['kg', 'lb'], reps: StrictInt, rpe: StrictFloat | StrictInt | None = None) -> dict:
        """Append one completed set. Load is a decimal string; explicitly confirm kg/lb. RPE is optional, 1–10 by 0.5."""
        return execute(request_id, 'log_set', {'session_id': session_id, 'exercise': exercise, 'load': load, 'unit': unit, 'reps': reps, 'rpe': rpe}, expected_revision)

    @mcp.tool(annotations=WRITE)
    def edit_set(request_id: str, session_id: str, expected_revision: StrictInt, set_id: str, exercise: str,
                 load: str, unit: Literal['kg', 'lb'], reps: StrictInt, rpe: StrictFloat | StrictInt | None = None) -> dict:
        """Correct one existing set by stable ID. Supply all fields; omitted RPE clears it. Keeps original values in audit history."""
        return execute(request_id, 'edit_set', {'session_id': session_id, 'set_id': set_id, 'exercise': exercise, 'load': load, 'unit': unit, 'reps': reps, 'rpe': rpe}, expected_revision)

    @mcp.tool(annotations=WRITE)
    def remove_set(request_id: str, session_id: str, expected_revision: StrictInt, set_id: str) -> dict:
        """Remove one set from the active workout by its stable ID. Recoverable with undo, and retained in audit history."""
        return execute(request_id, 'remove_set', {'session_id': session_id, 'set_id': set_id}, expected_revision)

    @mcp.tool(annotations=WRITE)
    def undo_set_change(request_id: str, session_id: str, expected_revision: StrictInt) -> dict:
        """Undo the last not-yet-undone set add, correction or removal in the active session. No redo in this MVP."""
        return execute(request_id, 'undo', {'session_id': session_id}, expected_revision)

    @mcp.tool(annotations=WRITE)
    def finish_session(request_id: str, session_id: str, expected_revision: StrictInt, finished_at: str | None = None) -> dict:
        """Finish the workout. Confirm the user is done first; the MVP makes finished workouts read-only. Optional finished_at is the actual ISO 8601 end time with UTC offset. Omit to finish now."""
        payload = {'session_id': session_id}
        if finished_at is not None:
            payload['finished_at'] = finished_at
        return execute(request_id, 'finish_session', payload, expected_revision)

    @mcp.tool(annotations=WRITE)
    def save_routine(request_id: str, session_id: str, name: str) -> dict:
        """Copy this session's completed sets to a reusable named routine. No change to the source session."""
        return execute(request_id, 'save_routine', {'session_id': session_id, 'name': name})

    @mcp.tool(annotations=READ)
    def session_audit(session_id: str) -> dict:
        """Read the append-only action trail including original values, corrections and undo references."""
        return {'events': store.events(session_id)}

    @mcp.tool(annotations=READ)
    def export_workouts() -> dict:
        """Export all local sessions, routines and audit events as versioned JSON. Contains private workout data."""
        return store.export()

    nutrition = NutritionStore(nutrition_db_path or companion_path(db_path or database_path()))
    register_nutrition(mcp, nutrition, FoodSources())
    register_tracking(mcp, TrackingStore(nutrition))
    return mcp


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Local Setwise stdio tools; use a private client connection.')
    parser.add_argument('--nutrition-db', help='Explicit nutrition journal path. Default: companion of WORKOUT_DB. Override only for an authorized journal connection.')
    args = parser.parse_args()
    create_server(nutrition_db_path=args.nutrition_db).run(transport='stdio')
