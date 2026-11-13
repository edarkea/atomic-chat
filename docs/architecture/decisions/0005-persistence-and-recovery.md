# ADR-0005: Use forward SQLite migrations with explicit secret recovery

- Status: Accepted
- Scope: SQLite persistence, schema migration and credential storage

## Context

Existing installations contain message history, account profiles, preferences, media metadata and stickers. Credentials require a different protection and recovery model from ordinary application data.

## Decision

Use a forward-only SQLite migration chain owned by `electron/persistence/schema-migrator.cjs`, composed by `PersistenceStore`. Migrations run transactionally, preserve account scope and must be idempotent. The current migrator ends at schema version 15.

Keep credentials in Electron safe storage through `SecretStore`, using an encrypted primary document, a valid backup document and explicit user-triggered recovery or reset. Secret recovery must not modify connection profiles or chat history.

## Alternatives considered

- Recreating the database from current tables during startup.
- Storing credentials in ordinary SQLite rows.
- Silently replacing a corrupt secret file.
- Rewriting historical fixtures instead of verifying production migration behavior.

These alternatives risk data loss, expose sensitive material or hide evidence needed for recovery.

## Consequences

- Schema changes require legacy fixtures, reopen, idempotency and account-isolation tests.
- A failed migration must stop safely rather than partially initialize the store.
- Secret recovery has an explicit user-visible outcome: recover from a valid backup or reset persistent credentials.
- Database backup and restore remain operational responsibilities; secret recovery is not a general SQLite restore mechanism.

See [Change persistence safely](../../guides/persistence-migrations.md) and [Recovery procedures](../../operations/recovery.md).
