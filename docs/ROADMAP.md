# Lifting roadmap

The current scope is lifting only: dependable live logging, custom routines and progressive-overload review. Nutrition, bodyweight/recovery and private exposure tracking are parked ideas; no integration work or health-data collection is included.

## Implemented

- Load/reps/optional RPE logging, explicit kg/lb and stable set IDs
- Corrections, remove/undo, append-only audit and idempotent retries
- Revision-conflict checks across UI/MCP writers
- Save/reuse routine snapshots
- Per-exercise session histories and latest-versus-previous load, reps and volume
- Distinct variants (such as bench press and Larsen press) remain separate

## Next useful work

1. Test the current workflow during real gym sessions on the intended phone/browser and MCP client
2. Complete an offline PWA: cached shell, IndexedDB queue, multi-tab locking and background sync with visible conflicts
3. One-tap last-session/repeat prefill, rest timer and optional dictation through a verified client
4. Routine editing/reordering and audited corrections after finishing a session
5. Import/restore, migrations and backup recovery
6. A stable exercise catalogue with explicit variant IDs and user-approved alias merges
7. Richer progression comparisons across comparable reps and effort, without claiming volume alone proves strength gains

## Before any hosted/mobile deployment

The current server is local-only with no authentication or encryption. A hosted version first needs authentication/authorization, HTTPS, secure storage, tenant isolation if multi-user, privacy/deletion choices, backups and a security review. Don't open a public tunnel as a shortcut. No GitHub publication, deployment, paid service or account connection is included in this build.
