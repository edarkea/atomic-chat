# ADR-0006: Read XEP-0054 profiles on demand

## Context

Atomic Chat already requests the local vCard during login to derive the operator display name. Contacts also need optional profile data, but roster aliases are local presentation data and must not be replaced by remote profile names. Profile photos arrive as XEP-0054 `PHOTO/BINVAL` content and must not cross the Renderer boundary as large Base64 strings or arbitrary remote URLs.

## Decision

Expose a separate `UserProfile` contract and `UserProfilePort`. The Renderer requests one bare JID at a time through `userProfiles.get`; Main validates the account, JID, sender authorization and connected session, then the `XmppAdapter` service performs a bounded `vcard-temp` IQ request. The existing `xmpp-display-name.cjs` vCard request and display-name normalization are reused.

Main rejects obsolete session responses, applies a five-second IQ timeout and limits concurrent profile requests per account. A validated PNG/JPEG vCard photo is kept behind an opaque, sender/account-scoped, expiring reference. Optional image streams use bounded ArrayBuffer chunks; no Base64 payload or external URL is returned.

The read capability defined here remains read-only for contacts. The later own-profile text update is defined separately in [ADR-0007](0007-xep-0054-own-profile-text-updates.md); cache invalidation through XEP-0153 is a separate event concern and does not change this contract's roster separation or image-reference safeguards. XEP-0084 remains out of scope.

## Alternatives considered

- Merge vCard fields into `Contact`: rejected because roster aliases and remote profile identity have different owners and lifecycles.
- Send the photo as Base64 in the profile result or event: rejected because it creates unbounded IPC and Renderer memory pressure.
- Return the vCard photo URL: rejected because external URLs are not an authorized local asset reference.
- Load every roster profile after login: rejected because profile reads are explicitly on demand and bounded.

## Consequences

- UI fallback order remains `Contact.name` → `UserProfile.displayName` → bare JID.
- Image rendering, if added later, must consume the reference stream and revoke it on account/window/session cleanup.
- Interoperability with a server that omits or rejects vCard data remains a typed, non-fatal profile error; login does not depend on contact profiles.
