# ADR-0007: Update the own XEP-0054 profile text

## Context

Atomic Chat reads `vcard-temp` profiles on demand through the contract established by ADR-0006. The application now needs to let an operator maintain their own profile and show the textual data published by contacts, without changing local roster names or introducing avatar notification protocols.

## Decision

Expose `userProfiles.update` as a versioned, account-scoped operation. Main accepts only the authenticated bare account JID and bounded textual fields for the personal profile, company/cargo, home address, `phone`, `mobile`, `fax`, `pager`, `birthday`, `description` and `website`. Birthday values use ISO `YYYY-MM-DD`; website values are accepted as HTTP(S) text and are not auto-navigated by Renderer. The service reads the current own vCard, applies the requested text changes, and sends one XEP-0054 IQ `set` through the existing helpers in `xmpp-display-name.cjs`.

Contact profiles remain read-only. The text operation does not edit or publish `PHOTO`. Avatar publication is a separate `userProfiles.avatar.update`/`clear` capability that publishes only XEP-0054 `PHOTO/TYPE/BINVAL` for the authenticated account. XEP-0153 is consumed separately as cache invalidation metadata; XEP-0084 remains out of scope. Roster aliases remain local presentation data and always take precedence over remote profile names.

## Alternatives considered

- Allow the Renderer to send raw vCard XML: rejected because it would bypass field validation and permit unsupported publication.
- Let a contact profile be edited from its conversation: rejected because only the authenticated account owns the update capability.
- Send avatar bytes from the Renderer: rejected because it would create a large IPC payload and bypass Main-process media validation.

## Consequences

- The profile editor is available for the current account only; contact details are rendered from on-demand `UserProfile` reads.
- Main enforces input limits, typed errors, one update at a time per account, timeout handling and session-generation freshness.
- Existing vCard photo data is preserved during text updates. Avatar publication is bounded to 512 KiB and validated PNG/JPEG data, and servers that reject vCard `PHOTO` return a typed profile error.
