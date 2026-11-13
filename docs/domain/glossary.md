# Domain glossary

## Account

The configured XMPP identity used to connect, authenticate, persist data and scope Renderer state. Account IDs are normalized at identity and storage boundaries.

## Connection generation

A monotonically changing identity for the current account session. Asynchronous results and events from an older generation must not update the current workspace after disconnect, account change or reconnection.

## Contact

A roster or conversation-derived peer record. A contact may include a display name, groups, subscription, presence and its source (`roster` or `conversation`).

## Conversation

A UI and persistence context identified by account, kind and JID. The supported kinds are `direct` and `muc`.

## Direct conversation

A one-to-one conversation addressed by a bare contact JID. Message history, replies, reactions, chat state and unread state are scoped to the account and direct JID.

## MUC

A multi-user chat room. The room is identified by its room JID; participants are identified by occupant JIDs and may have a separately verified real JID. Room state includes status, participants and session generation.

## Presence

The availability and optional status of a JID. Presence is evidence associated with the current authorized roster/session state; stale remote presence must not survive an authorization or session reset.

## Message

A direct-message record with account, conversation, sender, client message identity, body, status and creation time. It may include XMPP IDs, a reply reference, classification, persistence status and reactions.

## Message reference

The correlation data used by replies and reactions. It may contain a message ID, origin ID, stanza IDs, author JID and an optional quote. Navigation should prefer stable message identity over display text.

## Reaction

An emoji state associated with a target message and a set of identifiable or anonymous actors. Direct and MUC reactions carry their conversation source and may carry a session generation for stale-event filtering.

## Timeline

A chronological view that can combine text messages, images, files and stickers. Timeline paging uses directional cursors and account/conversation scope.

## Unread

A per-account, per-conversation count representing incoming messages that were not received while the conversation was both selected and the window focused. The store deduplicates incoming identities.

## Attention

Native or application-level notification state associated with an account that has unread content while the window is not focused. It is cleared when the account has no unread conversations or when attention is acknowledged.

## File transfer

An incoming or outgoing transfer with an offer, byte count, state, terminal reason and optional local actions. The current domain contract identifies IBB as the transfer transport.

## Media preview

A short-lived, account-scoped reference and stream used to display supported image content. Preview access is grant-based and may expire or be revoked.

## Sticker asset, sticker and sticker message

- An **asset** is the hashed image data and its dimensions/availability.
- A **sticker** is a library record pointing to an asset and carrying presentation metadata.
- A **sticker message** is the conversation-scoped reference used to render a received or sent sticker, including transport and availability state.

## Domain event

A versioned message from Main to the Renderer describing a state or fact, such as `message.received`, `roster.changed`, `muc.messageReceived` or `file.stateChanged`. Events are discriminated by `type` and validated before consumption.
