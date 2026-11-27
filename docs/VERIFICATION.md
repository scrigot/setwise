# Verification

Build tested on 2026-10-18 in the cloud development environment, using synthetic records and temporary SQLite databases. No personal workouts were imported.

## Passed

- Python 3.12.14; FastAPI 0.141.1; Uvicorn 0.52.1; MCP SDK 1.29.0
- Python compilation check
- 31 Python tests: domain rules, HTTP API, real CLI/TCP server and static assets, plus an actual MCP stdio client handshake/tool calls
- Same-command duplicate retries, including eight concurrent copies, save one set
- Distinct concurrent writers with the same revision produce one success and seven explicit conflicts
- Exact lb/kg conversion, preserved source unit/load, invalid types/ranges/units rejected
- Strict MCP numeric types, including boolean-rejection regression
- Edit/remove/undo, stable IDs, original values preserved in append-only audit
- Persistence across Store instances; routine snapshot/reuse; finished-session immutability
- Case/whitespace normalization without conflating exercise variants; progression comparison calculations
- Host/origin guards, JSON-only writes, actual byte limits including chunked bodies, CSV formula escaping
- JavaScript syntax and dependency-free frontend VM regression tests (see final count below)

An independent code review found two concrete issues: MCP type coercion and a header-only body-size limit. Both were fixed and covered by regression tests. Review found no lost-update or multi-step undo defect in the implemented paths.

## Not verified

- Visual browser rendering, touch ergonomics or real iPhone/Safari behavior
- Real browser storage eviction, service worker/background sync (not implemented), or physical network loss
- A real chat client's approval UI, voice input or ChatGPT mobile connector compatibility
- Fresh dependency installation on another operating system; full transitive dependency locking
- Fault-injected process/power-loss recovery; large-dataset performance; multi-user or internet-facing security

Browser verification was attempted but blocked by this execution environment: the standalone browser could not create required local sockets; the supported cloud browser could not reach the test server's isolated loopback network. A file-based fixture was also disallowed by browser URL policy. No browser restrictions were bypassed. The CLI server was instead tested over real TCP within one process namespace. Frontend tests execute the real JavaScript in a small DOM/fetch harness; they establish application-logic behavior, not browser layout or standards compatibility.

The installed FastAPI/Starlette test adapter emits an httpx deprecation warning, and the installed MCP SDK emits a Pydantic settings forward-reference warning. The tested flows still pass; dependency upgrades should be revalidated rather than assumed compatible.

## Repeat the checks

After installing development requirements and Node.js 22+:

```sh
./scripts/check.sh
```

The test suite creates and cleans temporary databases. It never writes to the default `data/` database. Open the app in a real local browser as the next verification step before relying on it in the gym.

## Frontend test count

15/15 frontend VM tests pass. Covered: start/log/edit/remove/finish/routine reuse, lost-response exact retry, sequential offline queue, explicit conflict review, reload recovery, double-submit protection, corrupted queue/cache/draft handling, escaped/CSP-compatible rendering, modal cancellation and back/forward, queued-vs-uncertain discard safety, all tabs/progression, and routine prefill without logging.
