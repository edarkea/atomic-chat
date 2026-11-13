# Domain overview

Atomic Chat models a multi-account XMPP workspace. The central identity is not a contact or a message alone; it is the combination of an account, a conversation kind and a normalized conversation JID.

## Bounded domain areas

| Area                     | Main concepts                                                                | Source of truth                             |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Session and connection   | Account, profile, endpoint, connection state, presence and certificate trust | `domain-connection.ts`, `domain-errors.ts`  |
| Direct messaging         | Message, reply reference, reaction, chat state and history                   | `domain-messaging.ts`                       |
| Conversations and unread | Conversation summary, active conversation, attention and unread keys         | `domain-application.ts`, `UnreadStore`      |
| Multi-user chat          | Room, participant, role, affiliation, room state and room message            | `domain-muc.ts`                             |
| Timeline and media       | Timeline item, image record, file history and preview stream                 | `domain-media.ts`                           |
| File transfer            | Offer, transfer state, transport and terminal reason                         | `domain-files.ts`                           |
| Stickers                 | Asset, sticker, pack, draft, sticker message and capability                  | `domain-stickers.ts`                        |
| Application events       | Versioned event envelope and discriminated payloads                          | `domain-event.ts`                           |
| Application results      | Success/error result and stable error codes                                  | `domain-application.ts`, `domain-errors.ts` |

## Identity model

Every account-scoped operation carries `accountId`. Conversation-scoped operations also carry `conversationId` or `roomJid`, together with a conversation kind when the same JID could represent different contexts.

Direct conversations use a bare JID. MUC conversations use a room JID and keep occupant identity separate from the room identity. A resource suffix may be present in incoming XMPP addresses, but conversation keys use the bare form.

The implementation currently exposes two related identity helpers:

- `bareJid()` lowercases the bare part and preserves the historical no-trim behavior.
- `normalizedBareJid()` trims the bare part before lowercasing.

Use the helper already expected by the boundary being changed. Do not silently switch normalization semantics in persistence keys or event correlation.

## State ownership

- Session identity and connection lifecycle belong to `SessionProfileCoordinator`.
- Conversation history, search and timeline windows belong to `ConversationHistoryCoordinator`.
- Roster contacts and persisted conversation summaries belong to `RosterConversationCoordinator`.
- Unread counters and native-attention state belong to `UnreadStore` and `UnreadConversationCoordinator`.
- Direct messages, replies and reactions are coordinated by `DirectMessagingCoordinator` and `ChatFacade`.
- MUC room state, participants, messages and room reactions are coordinated by `MucFacade` and its coordinators.
- Components render signals and invoke facade/coordinator methods; they do not become owners of shared domain state.

## Contract shape

Requests use `version: 1` and a `requestId` where they cross a process boundary. Responses use `Result<T>`:

```text
{ ok: true, value, version, requestId }
{ ok: false, error: { code, retryable, requestId, message }, version }
```

Events use a versioned envelope with `eventId`, an optional correlation identifier, a discriminated `type` and a type-specific payload. Unknown or malformed events are rejected at the Renderer subscription boundary.
