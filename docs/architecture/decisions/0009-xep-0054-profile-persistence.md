# ADR-0009: Persist XEP-0054 profiles and invalidate with XEP-0153

## Context

Reading the same contact vCard repeatedly causes unnecessary IQ traffic. Avatar bytes must remain protected by the existing Main-process reference protocol, and a cached value must not survive a remote avatar change.

## Decision

Electron Main stores bounded textual profile fields and validated PNG/JPEG bytes in `userData/profile-data`. The store is keyed by normalized account/JID, uses content-addressed image files, restrictive permissions, atomic index writes, a 128-entry limit and a 32 MiB byte quota. Stored data has no time-based expiry; reads revalidate file integrity and image metadata before returning a stored profile. Each response still receives a new sender-scoped expiring image reference.

The client parses XEP-0153 `vcard-temp:x:update` presence hashes. A different SHA-1 photo hash, including an empty hash for removal, invalidates the matching cache entry and emits the typed `profile.avatarChanged` event. The active profile coordinator refreshes only the visible profile. XEP-0084 PEP metadata/data is not implemented.

## Consequences

- Repeated profile dialogs use local Main data until a remote hash change invalidates it.
- Visible avatar components share one bounded Renderer object URL per account/reference and coalesce concurrent stream reads.
- Avatar streams are deferred until the component is near the viewport, and account changes revoke cached URLs and pending reads.
- A store failure is fail-soft: the XEP-0054 request remains authoritative.
- Profile-data files are private application data, not Renderer storage, SQLite records or external URLs.
- Offline profile display and contact-list avatar preloading remain separate future features.
