# CI, builds and updates

## CI focused

`ci-tests.yml` runs only on pull requests targeting `main`, regardless of the source branch. It does not run on commits pushed to `dev` or `main`, and it has no manual trigger. It has only `contents: read`, cancels redundant runs, applies a timeout, installs with `npm ci`, requires `npm audit --audit-level=high` to pass, and runs type/format checks plus `npm run test:ci:focused`. It does not execute the historical P0 suite, connect to XMPP, use production secrets, publish artifacts, or modify versions.

The high-severity gate is intentional: the complete audit still reports moderate findings in development/build tooling, but the current installed tree reports 0 high and 0 critical findings. `npm audit --omit=dev` also reports 0 findings, but that result is not used as the only release criterion because Electron is shipped in the application even though it is a development dependency.

## Dependency security

Electron was upgraded from the 39.x line to the exact stable `45.2.2`. The previous tree included Electron's `extract-zip@2.0.1` path and reported high file-write/symlink advisories; after the upgrade, the local audit reports 33 moderate, 0 high, and 0 critical findings, and Electron 45.2.2 no longer resolves that vulnerable `extract-zip` path. This is an audit result for the current lockfile, not a declaration that all runtime or packaging compatibility is proven.

The relevant dependency chains were checked explicitly: the old Electron path was `electron@39.8.10 → extract-zip@2.0.1`; the builder path is `electron-builder@26.18.0 → app-builder-lib@26.18.0 → @electron/asar@3.4.1 → glob@7.2.3 → minimatch@3.1.5`, with builder-side `minimatch@10.2.6` and `@electron/universal` also present; Angular CLI uses `pacote@21.5.1 → glob@13.0.6 → minimatch@10.2.6`; TypeScript ESLint also reaches `minimatch@10.2.6`. The current Electron 45.2.2 tree has no installed `extract-zip` package.

The high extract-zip findings were `GHSA-jmr9-qjv8-65gv` and `GHSA-7pqw-9j4j-h8q3`, affecting the old Electron runtime path. The remaining moderate advisories include `GHSA-3g3m-2fjr-6pw4` for the current `glob` range and `GHSA-g3hv-75wg-m249` for the current `minimatch` range. npm's suggested fixes require incompatible Angular CLI/tooling or an unrelated electron-builder/toolchain change, so they remain documented residuals rather than being forced into this release.

The remaining 33 moderate findings are confined to development/build dependency paths such as Angular CLI/pacote, Angular ESLint, TypeScript ESLint, electron-builder and `minimatch`. They are not resolved with `npm audit fix --force`, a downgrade of unrelated tooling, or an Angular 21 to Angular 22 migration. The `minimatch` constraint required by the current electron-builder graph remains a residual build-tool risk and must be re-evaluated when a compatible upstream release is available.

Native installation scripts are restricted through npm 11 `allowScripts` using exact resolved package identities: `@parcel/watcher@2.6.0`, `better-sqlite3@13.0.3`, `electron@45.2.2`, `electron-winstaller@5.4.0`, `esbuild@0.28.1`, `lmdb@3.5.1`, and `msgpackr-extract@3.0.6`. Optional `fsevents` is not approved because it is not required by the supported Windows/Linux build path. This is an explicit allowlist; global script approval and unrestricted script execution are not used.

Electron 45.2.2 is installed successfully with the existing Electron Builder 26 and Electron Updater 6 dependency lines, and `electron-builder install-app-deps` remains in the packaging workflows so `better-sqlite3` is rebuilt for the packaged Electron runtime. Actual packaged Windows/Linux installers, installed-update behavior, signing, and native-module execution on each target OS remain compatibility checks for CI/release and are not claimed by this local change.

## Manual installers

`manual-build.yml` is `workflow_dispatch` only and is separate from CI. It is used on demand to generate installable artifacts for QA, native-module validation, or manual inspection without creating a GitHub release. It produces Windows x64 NSIS, Linux x64 DEB, or Linux x64 AppImage installers according to the selected input. Every build runs the production Angular build, `electron-builder install-app-deps` for native modules such as `better-sqlite3`, and electron-builder with `--publish never`. Artifacts are retained for seven days and include SHA256 checksums; no database, `.env`, or user data is part of the configured application file set.

The Linux build runner is Ubuntu 22.04. The supported baseline for the packaged native module is Ubuntu 22.04 or Debian 12 with the required system libraries. AppImage is the preferred self-contained Linux update target. DEB installation/update requires a compatible package manager and is not an unattended repository update mechanism in this project.

## Stable release

`publish-release.yml` is manual only and always builds the current `main`. The release version is read from `package.json` (currently `0.0.1`) and must be stable `x.y.z`; the workflow derives the annotated tag as `v<package.json.version>`. It rejects an existing tag or release with that name, validates that the checked-out commit is exactly `origin/main`, and runs the high-severity audit, typecheck, format check, and focused tests before either platform build starts. After both platform builds and metadata checks pass under `production-release`, it creates and pushes the tag, then creates the GitHub release with `--verify-tag`. It never accepts a manually supplied version, tag, or ref, and does not publish prereleases or mix stable and prerelease channels.

The release job is protected by the `production-release` environment and is limited to `contents: write`; that permission is used to push the derived tag and create the release. The actor must be `edarkea` or be listed in the repository variable `ATOMIC_RELEASE_PUBLISHERS` as a comma-delimited username list. Configure required reviewers for that environment in GitHub Settings → Environments. Protect `main` and `v*` tags with rules that permit the authorized release workflow, and require the CI check before merging. Configure code-signing secrets and certificates in GitHub Actions only if signing is enabled; never put them in the repository or renderer.

### Status and residual risk

Corrected in this intervention: the packaged Electron high-severity dependency path, the absence of a high-severity CI gate, direct shell interpolation of release inputs, and release verification that accepted any descendant of a tag. Residual/blocking items are the moderate development/build advisories, unverified target-platform packaging and update E2E, and release signing/configuration. A production release must remain blocked until the target installers, update metadata, code signatures, and protected-environment approval are verified in the authorized CI run. No release, production tag, or GitHub permission was changed by this intervention.

Not executed by design: historical tests, the complete P0 suite, the general test suite, Openfire integrations, load tests, and a production packaging/release run. Those are not evidence of compatibility or security and must not be reported as passed.

## In-app updater

The renderer talks only to the typed preload update API. `electron-updater` is loaded lazily in Electron Main, only when the app is packaged, and uses the public GitHub provider `edarkea/atomic-chat`. Startup and periodic checks do not auto-download. Users can download an available update and install it only after download completion; installation is blocked while an active file transfer reservation exists. Chat state, SQLite paths, credentials and transfer data are not used as update metadata.

Windows NSIS and Linux AppImage are the supported updater targets. DEB is built and published as an installer but should be updated through the approved package distribution process; it is not treated as a universal in-place updater. Installed-update E2E validation remains future work and is deliberately not claimed by the focused tests.
