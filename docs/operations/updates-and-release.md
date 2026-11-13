# Updates and release operations

## Local development

The updater is unsupported in an unpackaged development run. Use `npm run build` and `npm run electron` for local smoke checks; do not treat a development update error as a release failure.

## Packaged update behavior

The update service is enabled only for packaged applications and uses the configured GitHub Releases feed for `edarkea/atomic-chat`.

Current safeguards:

- downloads are not automatic;
- installation is not automatic on application quit;
- prereleases and downgrades are disabled;
- update states are exposed as typed status events;
- installation is refused while critical file transfers are active;
- update checks are periodic and stop during application shutdown.

The user explicitly controls checking, downloading and installation through the application UI.

## Release validation

Before publishing a release:

1. confirm the intended version in `package.json` and release metadata;
2. install from a clean checkout with `npm ci`;
3. run the relevant type, format, test and production-build checks;
4. validate packaged startup on each supported target;
5. verify update status transitions with a controlled release channel;
6. verify that active transfers block installation;
7. confirm that no `.env`, secret file, database or test credential is included in artifacts;
8. record blocked platform checks instead of treating them as passes.

Signing, installed-update end-to-end validation and complete target-platform compatibility remain release checks rather than assumptions made from a successful Angular build.

## Rollback posture

Do not force-install a downgrade through the application updater. If a release must be withdrawn, publish the corrective release through the authorized release process and communicate the affected version. Preserve the user's data and secret-storage recovery path.
