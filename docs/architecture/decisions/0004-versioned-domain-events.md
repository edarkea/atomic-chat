# ADR-0004: Use versioned domain events across the process boundary

- Status: Accepted
- Scope: Main event routing, Preload subscriptions and Renderer event consumers

## Context

Messages, presence, reactions, chat states, MUC updates, file transfers, media and stickers arrive asynchronously. A set of ad-hoc listeners would make payload validation, correlation and cleanup inconsistent.

## Decision

Publish events as a versioned envelope containing `version`, `eventId`, a discriminated `type`, a typed payload and an optional correlation identifier. Main routes events through `domain.event`; the Renderer validates unknown input before passing a `TypedDomainEvent` to ports, facades or coordinators.

Use targeted routing for sender-scoped transfer events and broadcast only events that are safe for all active windows. Keep event payloads account-aware where the domain requires it.

## Alternatives considered

- Sending raw XMPP stanzas to the Renderer.
- One IPC channel per component.
- Trusting event payloads because they originate in the application.

Raw or unvalidated messages leak protocol details and allow malformed or stale data to reach state owners. Component-specific channels duplicate lifecycle and routing logic.

## Consequences

- Event producers and consumers share a discoverable type map.
- New events require payload validation and characterization tests.
- Event IDs and correlation IDs support asynchronous diagnostics.
- Consumers must still enforce account, conversation and session-generation identity; schema validation alone does not establish freshness.

See [Core data flows](../data-flow.md) and the domain event definitions in `src/app/core/domain/domain-event.ts`.
