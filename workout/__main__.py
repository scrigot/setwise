import argparse
import uvicorn
from .api import create_app


def main():
    parser = argparse.ArgumentParser(description='Run Live Workout on localhost. No account or API key required.')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--db', help='SQLite path. Defaults to WORKOUT_DB or ./data/workouts.sqlite3.')
    args = parser.parse_args()
    uvicorn.run(create_app(args.db), host='127.0.0.1', port=args.port)


if __name__ == '__main__':
    main()
