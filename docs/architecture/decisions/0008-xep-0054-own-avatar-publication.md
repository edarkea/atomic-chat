# ADR-0008: Publish the own avatar through XEP-0054

## Context

The own `UserProfile` editor can already update textual XEP-0054 fields. Users also need to publish a profile photo, while contacts must remain read-only and the Renderer must not receive large Base64 payloads or arbitrary external URLs.

## Decision

The avatar capability uses a native Main-process image picker and the existing `xmpp-display-name.cjs` vCard IQ helpers. Main validates a local PNG/JPEG file, limits it to 512 KiB and bounded dimensions, reads the current vCard, then publishes `PHOTO` with `TYPE` and `BINVAL` for the authenticated account. Clearing removes only `PHOTO`. Text fields and unrelated vCard children are preserved.

The Renderer receives only a refreshed `UserProfile` with an expiring opaque image reference. Image display uses the existing guarded open/read/close stream contract and creates a local object URL in the Renderer. Main may persist the validated profile and avatar bytes in its private bounded profile-data store. XEP-0153 photo hashes are consumed only to invalidate that stored data and refresh an already visible profile; XEP-0084 PEP metadata/data, contact editing and avatar publication through other protocols remain out of scope.

## Consequences

- Avatar changes are published through XEP-0054 and detected through XEP-0153 invalidation metadata; the client does not implement XEP-0084.
- A cancelled native picker is a successful no-op result.
- Server support for vCard photo publication remains an interoperability dependency and is reported as a typed error.
- The photo reference is temporary and scoped to the sender/account; persisted cache bytes stay in Main and are never exposed as an external URL.
