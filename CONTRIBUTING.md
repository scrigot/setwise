# Contributing to Setwise

Fork the repository, create a branch, and open a pull request against `main`. Include the problem, your change, and the checks you ran. Only the repository owner can grant write access or accept contributions; opening a pull request does not grant access to the owner's devices or journals.

Use synthetic data and temporary databases for development and tests. Never include personal workout/nutrition journals, snapshots, CSV exports, screenshots of real history, credentials, device addresses, or local environment files. Review the full staged diff before every push. `.env.example` files must contain placeholders only.

Run the Python and JavaScript suites in the root README. For mobile changes, run `npm ci`, `npm run typecheck`, `npm run lint`, and `npm test` in `mobile/`. Run `python3 scripts/check-public-files.py` to check tracked paths. This filename check is an additional guard, not a substitute for inspecting file contents or secret scanning.

Changes to `main` require a pull request with code-owner approval for contributors. The owner retains admin access to maintain the project. Keep fixes focused and discuss larger changes in an issue first. Contributions are accepted under the MIT license; preserve third-party notices.
