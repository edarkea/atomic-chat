import type { Contact, Presence } from '../domain';

/**
 * Applies an incoming remote presence update only to a contact with
 * the exact matching JID and a subscription permitting its visibility.
 *
 * Keep exact JID matching and mapping semantics as used by ChatFacade:
 * normalization is performed in roster reconciliation, not at event receipt.
 */
export function applyRemoteContactPresence(
  contacts: ReadonlyArray<Contact>,
  presence: Presence,
): Contact[] {
  return contacts.map((contact) =>
    contact.jid === presence.jid &&
    contact.subscription &&
    ['to', 'both'].includes(contact.subscription)
      ? { ...contact, presence }
      : contact,
  );
}

/**
 * Invalidates remote roster presence on account/session transitions.
 * A single timestamp is passed by the orchestrator for the self and
 * remote presence signals, preserving their ordering and correlation.
 */
export function resetRosterContactPresence(
  contacts: ReadonlyArray<Contact>,
  updatedAt: string,
): Contact[] {
  return contacts.map((contact) =>
    contact.source === 'roster'
      ? {
          ...contact,
          presence: { jid: contact.jid, availability: 'unknown' as const, updatedAt },
        }
      : contact,
  );
}
