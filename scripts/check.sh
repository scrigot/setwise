#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 -m compileall -q workout tests
python3 -m unittest discover -s tests -v
node --check static/app.js
node --test tests/test_frontend.mjs tests/test_nutrition_frontend.mjs tests/test_tracking_frontend.mjs
