# Recovery procedures

Recovery must preserve account identity, avoid overwriting evidence and require an authorized user decision. Do not delete application data as a first diagnostic step.

## Secret-storage states

The credential store reports one of these states:

- `available` — the primary encrypted store is valid and Electron safe storage is available.
- `recovery_available` — the primary store is unusable but the encrypted backup is valid.
- `corrupt` — the primary or backup document is invalid and no automatic recovery source is available.
- `unavailable` — safe storage cannot be used in the current environment.

## Recover from a valid backup

Use the application action exposed as “Recover secret storage” when the profile reports `recovery_available`.

The Main process:

1. verifies that the backup document is valid;
2. archives a non-missing primary file as a corruption evidence file;
3. atomically restores the valid backup to the primary path;
4. reloads the recovered values and marks storage available.

The recovery action does not delete connection profiles or ordinary chat history.

## Reset corrupt secret storage

Use “Reset secret storage” only when the user accepts that persistent credentials will be removed. The current implementation archives the invalid primary file, writes an empty secret store and removes the backup. Connection profiles and chat history remain separate.

The user must enter credentials again. Do not describe reset as data recovery; it is a controlled credential-store reset.

## Manual evidence handling

If the UI cannot complete recovery:

1. close Atomic Chat cleanly;
2. preserve the application data directory and corruption archive;
3. do not edit `secrets.json` or its backup by hand;
4. record the operating system, application version, storage status and non-secret error code;
5. use an authorized support or backup procedure before attempting a reset.

Never include secret files, passwords, certificate PEM values or full private paths in a ticket or log.

## Database and media recovery

SQLite history and media are separate from secret recovery. Before any manual file operation, close Atomic Chat and preserve a copy of the user data directory using the operating system's approved backup mechanism. Do not run migration experiments against the active user database.

Schema changes must follow [the persistence migration guide](../guides/persistence-migrations.md). The application migrator is forward-only and currently ends at schema version 15; historical data must be verified before a release.
