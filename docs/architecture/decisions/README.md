# Architecture decisions

These records capture decisions that constrain future changes. They complement the current architecture and domain documentation; they are not a chronological refactor log.

## Records

- [ADR-0001: Keep privileged operations in Electron Main](0001-electron-process-boundary.md)
- [ADR-0002: Scope state and persistence by account identity](0002-account-scoped-identity.md)
- [ADR-0003: Use explicit ports and a restricted Preload API](0003-ports-and-preload-capabilities.md)
- [ADR-0004: Use versioned domain events across the process boundary](0004-versioned-domain-events.md)
- [ADR-0005: Use forward SQLite migrations with explicit secret recovery](0005-persistence-and-recovery.md)
- [ADR-0006: Read XEP-0054 profiles on demand](0006-xep-0054-on-demand-profile-reads.md)
- [ADR-0007: Update the own XEP-0054 profile text](0007-xep-0054-own-profile-text-updates.md)
- [ADR-0008: Publish the own avatar through XEP-0054](0008-xep-0054-own-avatar-publication.md)
- [ADR-0009: Persist XEP-0054 profiles and invalidate with XEP-0153](0009-xep-0054-profile-persistence.md)

## ADR format

Each record states the context, the decision, alternatives considered and the consequences that future changes must preserve. New decisions should use the next number and link back to affected architecture, domain or reference documents.
