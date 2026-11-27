# Architecture

```
Mobile web UI -> HTTP adapter ----\
                                  > Store.command -> SQLite
Local MCP ----> stdio adapter ----/
```

- `workout/store.py`: validation, deterministic decimal conversion, session lifecycle, revisions, idempotency, undo, audit, routine snapshots and analysis
- `workout/api.py`: local-only HTTP transport, same-origin protections, exports and static hosting
- `workout/mcp_server.py`: twenty MCP tools: ten workout operations over Store and ten nutrition operations over a companion journal; no separate workout rules
- `workout/nutrition.py`: separate SQLite meal journal, serving scaling, provenance, partial-aware totals and audit
- `workout/food_sources.py`: fixed-provider USDA search and Open Food Facts barcode reads
- `workout/nutrition_mcp.py`: nutrition tools and instructions for chat interpretation of descriptions/photos/PDFs
- `static/`: no-build-step mobile interface with durable browser-local pending commands
- `tests/`: temporary-database domain, HTTP, concurrency and actual MCP transport tests

## Transaction boundary

A write begins with `BEGIN IMMEDIATE`. Existing request ID + identical fingerprint returns the recorded response. A mismatched fingerprint is rejected. A new command validates input and the session revision, modifies current state, appends an audit event, then inserts the response into the command ledger. Everything commits or rolls back together. SQLite serializes writers; the revision check makes stale intent visible rather than hiding it.

A single-active-session unique partial index complements application checks. State and exports use read transactions for coherent snapshots. SQLite WAL supports UI and MCP reads while a writer commits. There is no server-side queue, remote worker or model call in the logging path.

## Undo and audit

Each set mutation stores full before/after snapshots. Undo references the latest un-undone set event and restores its before-sets while incrementing the live revision. Undo does not delete history or reuse an earlier revision. Audit update/delete triggers prevent accidental rewriting through the normal application. This costs space and is intentionally simple; a future event compaction policy would require a privacy and recovery design.

## Deliberate limits

Single user, one active workout, small datasets, no database migration framework beyond schema version 1, no pruning/pagination, no remote auth, Web Lock single-tab ownership where supported (storage-event detection only otherwise), no health-data integration. Source-level tests establish core invariants; they do not establish production hardening or platform integrations.
