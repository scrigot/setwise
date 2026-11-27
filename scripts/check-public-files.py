#!/usr/bin/env python3
"""Reject known private/generated file categories in Git's index, without reading journals."""
from pathlib import PurePosixPath
import subprocess
import sys

files = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
private_dirs = {"data", "artifacts", "node_modules", ".venv", ".expo", "dist", "web-build", "site", ".gstack", ".21st", ".claude", ".codex", "__pycache__"}
private_suffixes = {".csv", ".db", ".sqlite", ".sqlite3", ".pem", ".key", ".p12", ".p8", ".jks", ".mobileprovision", ".zip", ".gz", ".log", ".bak", ".backup"}
blocked = []
for filename in filter(None, files):
    path = PurePosixPath(filename)
    name = path.name.lower()
    if (private_dirs.intersection(path.parts)
            or (name.startswith(".env") and name != ".env.example")
            or ".private." in name or ".sqlite" in name or ".db-" in name
            or path.suffix.lower() in private_suffixes
            or name in {"agents.md", ".ds_store"}
            or filename == "mobile/scripts/check-ui.mjs"):
        blocked.append(filename)
if blocked:
    print("Refusing private/generated paths:\n" + "\n".join(blocked), file=sys.stderr)
    sys.exit(1)
print(f"Public-file check passed ({len(list(filter(None, files)))} tracked files). Inspect content separately.")
