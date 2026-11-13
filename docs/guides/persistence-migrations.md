# Change persistence safely

Persistence changes affect existing installations. Treat the current schema and migration chain as compatibility contracts, not as disposable test fixtures.

## Ownership

- `electron/persistence/storage.cjs` composes the SQLite-backed stores.
- `electron/persistence/schema-migrator.cjs` owns schema creation and forward migrations.
- Specialized stores own account profiles, message history, media, preferences, stickers and timeline data.
- The database is created below the Electron `userData` path with restricted file permissions where the platform supports them.

## Before editing a schema

1. Identify the data owner and every read/write consumer.
2. Inspect the current schema version and the migration path from older supported versions.
3. Check account-scoping and foreign-key behavior.
4. Decide whether the change is a schema migration, a store-level compatibility fix or only a query change.
5. Avoid changing the production migrator merely to satisfy an obsolete fixture expectation.

The current migrator terminates at schema version 15. Historical tests may construct older schemas, but they must verify preservation of data and idempotent migration to the current version.

## Migration requirements

- Apply each migration inside the existing transaction strategy.
- Make the migration safe to run again after an interrupted or repeated startup.
- Preserve messages, account separation, references, stickers, packages, media metadata and preferences.
- Add required indexes and foreign keys deliberately.
- Preserve unknown or recoverable historical data rather than silently dropping it.
- Keep schema changes forward-only unless an explicitly approved recovery procedure exists.
- Do not store credentials or secret material in ordinary SQLite records.

## Required characterization

For a schema or persistence change, add or update tests that cover:

1. A fresh database reaches the current schema.
2. The affected legacy schema migrates successfully.
3. The migration preserves records and account boundaries.
4. Reopening the database does not duplicate or lose data.
5. Running migration again is idempotent.
6. Invalid source metadata fails safely and leaves no partial migration.
7. The affected store returns the existing public contract and error codes.

Use isolated temporary directories. Never point migration tests at a real user profile or production database.

## Recovery and release discipline

Before distributing a migration, preserve a recoverable copy of the user database through the established application recovery process. Test upgrade and reopen behavior on representative historical fixtures. Record the source and target schema versions, data checks and any blocked environment capability.

Do not modify historical fixtures to obtain a pass until the production behavior and data invariants have been verified.
