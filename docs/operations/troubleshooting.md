# Troubleshooting

Start with the smallest safe diagnostic. Record versions, status codes and reproducible steps, but redact credentials, tokens, certificate PEM values and private paths.

## Application does not start

1. Confirm that dependencies were installed with `npm ci`.
2. Run `npm run build` and inspect the first build error.
3. Confirm that `.env` exists only when a connection flow requires it and follows `.env.example`.
4. Check that the application data directory is writable.
5. Remove no data until the user data directory has been preserved through an approved backup procedure.

## Cannot connect to XMPP

Check the endpoint host, domain, port and explicit transport. `starttls` and `direct-tls` are distinct configurations. Verify DNS, firewall access and the server certificate through an authorized channel.

Useful error categories include `INVALID_ENDPOINT`, `INVALID_DOMAIN`, `SERVER_UNREACHABLE`, `STARTTLS_UNAVAILABLE`, `TLS_NEGOTIATION_FAILED`, `CERTIFICATE_UNTRUSTED` and `CERTIFICATE_IDENTITY_MISMATCH`.

Do not set insecure TLS merely to bypass a certificate problem. In packaged builds the transport policy rejects that setting.

## Credential storage is unavailable or corrupt

Read the profile's credential storage status. For `recovery_available`, use the explicit recovery action. For `corrupt`, explain that reset removes persistent credentials and requires re-entry. For `unavailable`, investigate the operating system's Electron safe-storage capability without copying secrets into a workaround file.

See [Recovery procedures](recovery.md).

## IPC or authorization errors

An `UNAUTHORIZED` result can indicate a stale/destroyed window, an unexpected frame URL or an unregistered capability. Reproduce with the packaged or configured development URL and inspect the affected handler tests. Do not disable the sender guard.

## History, media or sticker inconsistencies

Check account and conversation identity first. Preserve the database and media directories, then run the affected isolated tests against temporary data. For schema issues, record the current schema version and follow [the migration guide](../guides/persistence-migrations.md).

## Update is unavailable

Updates require a packaged build. In a packaged build, check the reported update state and error code, release availability and network access. An installation conflict may mean that an active file transfer is still running; let it reach a terminal state before retrying.

## Evidence to collect

- application version and target platform;
- exact user action and reproducible sequence;
- stable error code and connection state;
- whether the issue affects one account or all accounts;
- whether the issue survives a clean restart;
- focused test or build output with secrets and private paths removed.
