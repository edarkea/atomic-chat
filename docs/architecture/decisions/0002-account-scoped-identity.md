# ADR-0002: Scope state and persistence by account identity

- Status: Accepted
- Scope: Domain, Renderer state, XMPP sessions and persistence

## Context

The client can manage connection profiles and session state for more than one account over time. Conversations, unread counters, history, presence, reactions, files and stickers must not cross account boundaries. Async work can also finish after the user switches accounts or reconnects.

## Decision

Carry `accountId` through account-scoped requests, domain events, stores, persistence records and session maps. Identify a conversation with account, kind (`direct` or `muc`) and a bare JID. Use a session generation to invalidate results and events from a previous connection lifecycle.

Use the existing identity helpers at their established boundaries and preserve their historical semantics. Do not replace a key or comparison with a different normalization rule without a compatibility review.

## Alternatives considered

- Treating the currently selected account as implicit.
- Keying conversations only by JID.
- Clearing all application state on every account change.

Implicit or JID-only identity allows stale data to be applied to the wrong workspace. Global clearing loses useful independent state and does not by itself protect late async callbacks.

## Consequences

- DTOs and tests carry more identity fields, but cross-account behavior is explicit.
- Event handlers must verify account and generation before mutating state.
- Direct and MUC flows remain separate even when they share presentation concepts.
- Persistence queries and indexes must include account scope where the domain requires it.

The resulting business rules are summarized in [Business rules](../../domain/business-rules.md).
