"""Private tracking tools; same authorized journal as nutrition."""
from typing import Literal
from pydantic import StrictInt
from .nutrition_mcp import READ, WRITE
from .store import DomainError


def register_tracking(mcp, store):
    def call(fn, *args):
        try:
            return fn(*args)
        except DomainError as exc:
            raise ValueError(f'{exc.code}: {exc.message}') from exc

    @mcp.tool(annotations=READ)
    def tracking_state(start_date: str, end_date: str, timezone: str = 'America/New_York') -> dict:
        """Read dated bodyweight, creatine taken/dose, revisions and available-measurement seven-day weight averages (max 366 days). Missing dates are unknown, never zero or missed doses."""
        return call(store.state, start_date, end_date, timezone)

    @mcp.tool(annotations=WRITE)
    def tracking_save_entry(request_id: str, day: str, timezone: str, kind: Literal['bodyweight','creatine'], unit: Literal['lb','kg','g'], value: str | None = None, notes: str = '', occurred_at: str | None = None, expected_revision: StrictInt | None = None) -> dict:
        """Log requested weigh-in (explicit lb/kg and measured value) or creatine taken (g, null dose if unknown). Use actual YYYY-MM-DD and IANA timezone; leave exact timestamp null when unknown. Read tracking_state first. One entry per kind/date/timezone; corrections require its revision. Retry same request_id+args after uncertainty. No calorie or macro effect."""
        return call(store.command, request_id, 'save_entry', {'day':day,'timezone':timezone,'kind':kind,'unit':unit,'value':value,'notes':notes,'occurred_at':occurred_at}, expected_revision)

    @mcp.tool(annotations=WRITE)
    def tracking_set_removed(request_id: str, day: str, timezone: str, kind: Literal['bodyweight','creatine'], removed: bool, expected_revision: StrictInt) -> dict:
        """Recoverably remove or restore a requested tracking entry. Read current revision first; preserves audit trail."""
        return call(store.command,request_id,'remove_entry' if removed else 'restore_entry',{'day':day,'timezone':timezone,'kind':kind},expected_revision)
