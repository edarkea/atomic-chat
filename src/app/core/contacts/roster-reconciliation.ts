import type { Contact } from '../domain';
import { bareJid } from '../identity';

/**
 * Reconciles the server's current roster against local conversation contacts.
 * Retains prior presence only when the new subscription authorizes visibility.
 * Duplicate roster JIDs keep the first insertion position and the last payload.
 */
export function reconcileRosterContacts(
  previous: ReadonlyArray<Contact>,
  roster: ReadonlyArray<Contact>,
  timestamp: () => string = () => new Date().toISOString(),
): Contact[] {
  const previousByJid = new Map(previous.map((contact) => [bareJid(contact.jid), contact]));
  const normalized = new Map<string, Contact>();

  for (const contact of roster) {
    const jid = bareJid(contact.jid);
    const authorized = contact.subscription === 'to' || contact.subscription === 'both';
    const old = previousByJid.get(jid);
    normalized.set(jid, {
      ...contact,
      jid,
      source: 'roster',
      presence:
        authorized && old?.presence
          ? old.presence
          : {
              jid,
              availability: 'unknown',
              updatedAt: timestamp(),
            },
    });
  }

  const local = previous.filter(
    (contact) => contact.source === 'conversation' && !normalized.has(bareJid(contact.jid)),
  );
  return [...normalized.values(), ...local];
}
