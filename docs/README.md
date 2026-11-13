# Atomic Chat documentation

This directory is the maintained knowledge base for Atomic Chat. It explains how to set up the repository, work within its boundaries, validate changes, and understand the architecture.

## Start here

- [Setup](getting-started/setup.md) — prerequisites, local configuration and first launch.
- [Development workflow](getting-started/development.md) — repository map and safe change boundaries.
- [Testing and validation](getting-started/testing.md) — available commands and how to report results.
- [Architecture overview](architecture/overview.md) — runtime layers, dependencies and lifecycle.
- [System context](architecture/system-context.md) — trust boundaries and external systems.
- [Core data flows](architecture/data-flow.md) — startup, requests, events, persistence and shutdown.
- [Architecture decisions](architecture/decisions/README.md) — accepted decisions and their consequences.
- [Domain overview](domain/overview.md) — bounded areas, identity and state ownership.
- [Domain glossary](domain/glossary.md) — shared terminology for developers and agents.
- [Business rules](domain/business-rules.md) — current invariants and behavioral contracts.
- [Domain invariants](domain/invariants.md) — concise maintenance checklist for business rules.
- [Add or change a feature](guides/add-feature.md) — safe Renderer and cross-layer changes.
- [Add an IPC capability](guides/add-ipc-capability.md) — request, event and security-boundary workflow.
- [Change persistence safely](guides/persistence-migrations.md) — migrations, compatibility and recovery.
- [Validation workflow](guides/validation-workflow.md) — checks selected by change risk.
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
- `guides/` — repeatable development and maintenance procedures.
- `security/` — security boundaries and control expectations.
- `operations/` — release, recovery and troubleshooting procedures.

## Maintenance rules

- Keep examples aligned with the scripts and configuration present in the repository.
- Update documentation when a user-visible command, boundary or contract changes.
- Report only validations that were actually executed, including skipped or blocked checks.
- Do not place credentials, tokens, private endpoints or production data in documentation.
- Keep [AGENTS.md](../AGENTS.md) as the instruction source for agent-assisted work.
- Follow the contribution workflow in [CONTRIBUTING.md](../CONTRIBUTING.md).
