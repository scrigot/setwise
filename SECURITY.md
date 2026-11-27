# Security and privacy

## Source code and personal data

This public repository distributes source code under MIT. Anyone may view, fork, copy, and modify their own copy under that license. This grants no access to the maintainer's devices, accounts, databases, or private journals, and no permission to change this repository directly. Contributors submit pull requests for review.

Personal workout and nutrition records are not part of the source distribution. Git ignores data directories, SQLite files, exports, private snapshots, local environment files, screenshots/artifacts, and generated builds. Never force-add these files. Run `python3 scripts/check-public-files.py` and inspect staged content before committing. Secret scanners detect some credentials, not all personal information.

## Runtime boundaries

The core API is a single-user loopback service with no user authentication or database encryption. It must stay on a trusted device. Do not bind it publicly or put it behind a public tunnel. Protect local files, browser storage, device backups, and exports with OS/device access controls.

The optional mobile history reader relies on a private Tailscale network, explicit allowed device addresses, and Host/Origin checks. Configure tailnet access controls as well. It is not designed for the open internet or untrusted users. Allowed devices can read completed history and save gym labels. Source publication does not deploy any service or change existing network permissions.

Expo `EXPO_PUBLIC_*` values are embedded in app bundles; they are not secrets. Keep private configured builds local. Screenshots and browser/device caches can contain journal data even when the Git repository does not.

## Reporting a vulnerability

Use this repository's **Security → Report a vulnerability** for private reporting. Do not post credentials, personal journals, or exploitable private deployment details in a public issue. Include reproduction steps using synthetic data, the affected commit, and the expected boundary. There is no guaranteed response time or formal security audit claim.

## Known dependency finding (November 26, 2026)

A clean mobile install's `npm audit` reported a moderate minimatch denial-of-service advisory ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)) through Expo's fingerprint build tooling. npm counts the vulnerable package and two parent packages as three findings. The suggested automatic fix downgrades Expo to a different major version; that migration has not been applied or validated. This is an outstanding dependency finding, not evidence of leaked journal data. Run `npm audit` to check the current dependency state before building with untrusted inputs.
