# CI, builds and updates

## CI focused

`ci-tests.yml` runs exclusively on pull requests targeting `main`. It has only `contents: read`, cancels redundant runs, applies a timeout, and runs `npm ci`, type/format checks, and `npm run test:ci:focused`. It does not run on pushes, target `dev`, run manually, execute the historical P0 suite, connect to XMPP, use production secrets, publish artifacts, or modify versions.

## Manual installers

`manual-build.yml` is `workflow_dispatch` only. It produces Windows x64 NSIS, Linux x64 DEB, or Linux x64 AppImage installers according to the selected input. Every build runs the production Angular build, `electron-builder install-app-deps` for native modules such as `better-sqlite3`, and electron-builder with `--publish never`. Artifacts are retained for seven days and include SHA256 checksums; no database, `.env`, or user data is part of the configured application file set.

The Linux build runner is Ubuntu 22.04. The supported baseline for the packaged native module is Ubuntu 22.04 or Debian 12 with the required system libraries. AppImage is the preferred self-contained Linux update target. DEB installation/update requires a compatible package manager and is not an unattended repository update mechanism in this project.

## Stable release

`publish-release.yml` is manual only. It requires a stable `x.y.z` version, an existing `v<version>` tag, and a ref of `main` or that tag. The tag must point to a commit reachable from `origin/main`, and `package.json` must have the same version. The workflow builds both platforms with `--publish never`, verifies the generated update manifests and checksums, and only then uploads the exact build outputs to the existing tag. It never creates tags, bumps versions, publishes prereleases, or mixes stable and prerelease channels.

The release job is protected by the `production-release` environment and is limited to `contents: write`. The actor must be `edarkea` or be listed in the repository variable `ATOMIC_RELEASE_PUBLISHERS` as a comma-delimited username list. Configure required reviewers for that environment in GitHub Settings → Environments. Protect `main`, require the CI check, and protect `v*` tags so only approved maintainers can create them. Configure code-signing secrets and certificates in GitHub Actions only if signing is enabled; never put them in the repository or renderer.

## In-app updater

The renderer talks only to the typed preload update API. `electron-updater` is loaded lazily in Electron Main, only when the app is packaged, and uses the public GitHub provider `edarkea/atomic-chat`. Startup and periodic checks do not auto-download. Users can download an available update and install it only after download completion; installation is blocked while an active file transfer reservation exists. Chat state, SQLite paths, credentials and transfer data are not used as update metadata.

Windows NSIS and Linux AppImage are the supported updater targets. DEB is built and published as an installer but should be updated through the approved package distribution process; it is not treated as a universal in-place updater. Installed-update E2E validation remains future work and is deliberately not claimed by the focused tests.
