# Atomic Chat documentation

This directory is the maintained technical reference for Atomic Chat. It describes the system architecture, domain rules, contracts, security boundaries, configuration and operations.

## Start here

- [Setup](getting-started/setup.md) — prerequisites, local configuration and first launch.
- [Architecture overview](architecture/overview.md) — runtime layers, dependencies and lifecycle.
- [System context](architecture/system-context.md) — trust boundaries and external systems.
- [Core data flows](architecture/data-flow.md) — startup, requests, events, persistence and shutdown.
- [Architecture decisions](architecture/decisions/README.md) — accepted decisions and their consequences.
- [Domain overview](domain/overview.md) — bounded areas, identity and state ownership.
- [Domain glossary](domain/glossary.md) — shared terminology for developers and agents.
- [Business rules](domain/business-rules.md) — current invariants and behavioral contracts.
- [Domain invariants](domain/invariants.md) — concise maintenance checklist for business rules.
- [Security model](security/security-model.md) — process, IPC, TLS, secrets and grant controls.
- [Recovery procedures](operations/recovery.md) — credential recovery and safe data handling.
- [Updates and release operations](operations/updates-and-release.md) — packaged updater behavior and release checks.
- [Troubleshooting](operations/troubleshooting.md) — safe diagnostics for common failures.
- [API and contract reference](reference/api.md) — Renderer, Preload and Main-process capabilities.
- [Environment variables](reference/environment-variables.md) — supported local configuration.

## Documentation areas

The documentation will grow around these areas as they are audited:

- `architecture/` — application boundaries, composition and runtime flows.
- `domain/` — domain concepts, invariants and state transitions.
- `reference/` — public contracts, DTOs, IPC channels and configuration.
- `security/` — security boundaries and control expectations.
- `operations/` — release, recovery and troubleshooting procedures.

## Maintenance rules

- Keep examples aligned with the scripts and configuration present in the repository.
- Update documentation when a user-visible command, boundary or contract changes.
- Report only validations that were actually executed, including skipped or blocked checks.
- Do not place credentials, tokens, private endpoints or production data in documentation.
