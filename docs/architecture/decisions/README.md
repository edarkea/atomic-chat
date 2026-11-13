# Architecture decisions

These records capture decisions that constrain future changes. They complement the current architecture and domain documentation; they are not a chronological refactor log.

## Records

- [ADR-0001: Keep privileged operations in Electron Main](0001-electron-process-boundary.md)
- [ADR-0002: Scope state and persistence by account identity](0002-account-scoped-identity.md)
- [ADR-0003: Use explicit ports and a restricted Preload API](0003-ports-and-preload-capabilities.md)
- [ADR-0004: Use versioned domain events across the process boundary](0004-versioned-domain-events.md)
- [ADR-0005: Use forward SQLite migrations with explicit secret recovery](0005-persistence-and-recovery.md)

## ADR format

Each record states the context, the decision, alternatives considered and the consequences that future changes must preserve. New decisions should use the next number and link back to affected architecture, domain or reference documents.
