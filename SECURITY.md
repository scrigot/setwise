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

## Dependency remediation (November 26, 2026)

The minimatch denial-of-service advisory [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) is resolved by an npm override scoped to `@expo/fingerprint`, pinning its `minimatch` dependency to **11.0.9**. Expo remains on SDK 58. The lockfile contains the patched version, and `npm ci` / `npm audit` reported zero known vulnerabilities at verification time.

The mobile test suite exercises real Expo fingerprint generation, including ignored-file stability and changes to explicitly included files, to check compatibility with this override. CI runs `npm audit --audit-level=moderate` to catch future reported findings. Remove the override when Expo's fingerprint dependency supports a patched version directly, then rerun the audit and compatibility checks. A clean dependency audit does not replace a full application security review.
