# Business rules and invariants

These rules are the current behavioral contracts represented by the domain types, stores, coordinators and boundary validators. Tests are the executable characterization; this document explains the intent behind them.

## Account and session rules

1. Account identity is part of every connection, message, history, unread and persistence operation.
2. A connection event is accepted only for the active account and an accepting session.
3. Disconnect, failure, account switching and reconnection advance or invalidate the session generation as appropriate.
4. Results from an older generation must not overwrite connection, roster, presence, history, preferences, chat state or message state for the current session.
5. A temporary connection loss may preserve pending local message state, but it must not authorize stale remote events.
6. Credentials and certificate decisions remain Main-process concerns. Renderer state may contain status, never secret-storage handles or raw credentials.

## Identity and conversation rules

1. Direct and MUC conversations are distinct even when their display labels look similar.
2. Conversation keys are scoped by `accountId`, kind and bare JID.
3. Resource-qualified JIDs may identify a sender resource, but they must not create a second direct conversation.
4. MUC room identity is the room JID; occupant identity is separate and must not be used as the room key.
5. Account or conversation changes invalidate pending history, search, navigation and scroll work tied to the previous context.

## Messaging rules

1. A message carries a stable client identity for outgoing correlation and may carry XMPP stanza/origin identifiers for reconciliation.
2. Reply navigation uses `MessageReference` and should resolve the original message in the same account and conversation.
3. Reaction state is scoped to account, conversation and target message. Direct and MUC reaction sources are not interchangeable.
4. A stale reaction or reply event must not update a different account, room or conversation after workspace changes.
5. History and timeline paging use cursors and direction; older and newer pages must be merged without duplicating messages.

## Presence and roster rules

1. Roster contacts may be created from roster data or from conversation activity, but the source must remain distinguishable.
2. Remote presence is valid only while the corresponding roster/session evidence remains authorized.
3. Losing authorization or a session must clear or downgrade remote presence before fresh evidence is accepted.
4. Persisted conversation summaries are correlated with their account and must not leak into another account's workspace.

## Unread and attention rules

1. An incoming message increments unread when its conversation is not selected or the application window is not focused.
2. Native attention is requested only when unread is incremented while the window is unfocused.
3. A message received in the selected conversation while the window is focused does not increment unread.
4. A conversation is marked read only when it is selected and the window is focused.
5. Incoming message identities are deduplicated per account and conversation kind.
6. Resetting an account clears its unread counters, attention state and deduplication identities without affecting another account.

## MUC rules

1. Room status is explicit: `idle`, `joining`, `joined`, `leaving` or `failed`.
2. Participant roles and affiliations are server-derived values; the client must not infer moderation authority from display text.
3. Room messages and notices carry a session generation and are ignored when that generation is no longer current.
4. A room message can come from live traffic or server history; the source must remain available to consumers.
5. MUC support must preserve room/occupant separation and must not be treated as direct-message behavior.

## Files and media rules

1. Transfer byte counts use decimal strings to avoid precision loss at contract boundaries.
2. A transfer has explicit terminal outcomes and must release resources after completion, failure or cancellation.
3. File previews are limited to supported image types and guarded, expiring references.
4. Preview, media and file-history operations remain account- and conversation-scoped.
5. Local open/reveal actions are Main-process operations and are never implemented by direct Renderer filesystem access.

## Stickers rules

1. Sticker assets are content-addressed by the declared SHA-256 metadata and retain availability state.
2. Sticker libraries, packs, drafts and sticker messages are account-scoped.
3. Pack and draft updates use revisions to detect stale writes.
4. Sticker messages preserve transport status separately from local availability.
5. Sticker preview access uses an account/sticker grant and must not expose arbitrary local or remote paths.

## Contract and event rules

1. Boundary requests and events use the declared contract version.
2. Event consumers accept only known discriminated event types with valid payloads.
3. `Result<T>` distinguishes successful values from typed application errors; callers must not infer success from a truthy object alone.
4. Correlation identifiers connect asynchronous responses/events to their originating operation when supplied.
5. Errors should retain stable error codes and retryability semantics; user-facing text may be localized or adapted separately.
