# Setwise mobile

Expo / React Native workout history for iOS, Android, and web. It reads completed sessions from the optional private Tailscale reader in `server/`, with search, calendar filters, personal records, and gym labels. Workout logging stays in the Python web/MCP app; the reader can save gym labels in a separate local database.

## Development

Use Node.js 22+:

```sh
npm ci
cp .env.example .env.local
npm run web -- --localhost --port 8081
```

Set `EXPO_PUBLIC_HISTORY_URL` to your own reader's `/history` endpoint and set `EXPO_PUBLIC_GYMS` to pipe-separated labels. Without a reachable reader, the app starts empty and displays a connection error. It caches the last successful history on the device. There is no bundled personal journal or public demo backend.

Expo embeds `EXPO_PUBLIC_*` values in distributed bundles. Never put passwords, tokens, or private journal data in these values, and do not publicly distribute a build containing private configuration. Environment files, snapshots, screenshots, exports, and build output are gitignored. The import helper creates a private snapshot for local tooling; it is not the live history source.

## Optional private reader

Run the root Python app on loopback. Configure Tailscale access controls, then copy `server/history.py` to `~/.local/share/setwise/mobile-history/history.py` on that same host. Copy `server/.env.example` to `~/.config/setwise/history.env`, fill in the server's Tailscale IPv4 address and comma-separated allowed client addresses, and restrict the file to its owner (`chmod 600`). `HISTORY_GYMS` must match the mobile gym labels.

Install `server/setwise-mobile-history.service` as a systemd **user** service only after configuring the environment. Its bind address must be in Tailscale's IPv4 range. The reader checks client address, Host, and Origin; it has no standalone user authentication. Never publish it through a public tunnel. See [security](../SECURITY.md).

For the private phone web app, run `node scripts/build-phone-web.mjs` from this directory and copy `dist/phone/` into `~/.local/share/setwise/mobile-history/site/` on your private host. Connect the phone to your tailnet, open `http://YOUR_TAILSCALE_ADDRESS:8795/`, and use Safari's Add to Home Screen. Keep that build private.

## Verification

```sh
npm run typecheck
npm run lint
npm test
```

For an optional integration check against your own nonempty journal and a running local preview, use `node --env-file=.env.local scripts/check-sync.mjs`. It reads live history and simulates changes only inside an isolated browser; it is not run in CI. Native physical-device acceptance is still outstanding; see [historical verification](docs/verification.md).
