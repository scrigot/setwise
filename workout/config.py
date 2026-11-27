from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent.parent

def database_path() -> Path:
    return Path(os.environ.get('WORKOUT_DB', str(ROOT / 'data' / 'workouts.sqlite3'))).expanduser().resolve()
