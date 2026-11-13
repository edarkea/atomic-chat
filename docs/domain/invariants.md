# Domain invariants

This is the concise maintenance checklist for business rules. When a change modifies one of these invariants, update this page and the relevant tests before considering the change complete. Detailed explanations remain in [Business rules](business-rules.md).

## Identity and isolation

- Account identity is explicit in account-scoped requests, events, stores and persistence.
- A conversation key preserves account, kind (`direct` or `muc`) and bare JID.
- Room identity and occupant identity remain separate.
- Older session generations cannot mutate current account or conversation state.

## Messaging and history

- Replies and reactions resolve within the same account and conversation.
- History and timeline cursors are directional and must not duplicate items when pages merge.
- Direct and MUC messages keep their distinct payload and source semantics.

## Presence, unread and attention

- Remote presence is accepted only while roster/session authorization remains valid.
- Unread increments when the conversation is not selected or the window is not focused.
- Read marking requires both selection and focus.
- Incoming identities are deduplicated per account and conversation kind.
- Resetting one account does not clear another account's unread or attention state.

## Files, media and stickers

- Transfer, media, preview and sticker operations remain account-scoped.
- Terminal transfers release resources and retain explicit end reasons.
- Preview access is guarded, expiring and revocable.
- Sticker assets use declared SHA-256 metadata and sticker-pack writes use revisions.

## Boundary and persistence contracts

- Requests and events preserve contract version and stable error semantics.
- Unknown or malformed domain events are rejected at the subscription boundary.
- SQLite migrations preserve account isolation, historical data and idempotency.
- Secret recovery is explicit and does not silently overwrite corrupt evidence or unrelated chat data.
