import type { Contact, ConversationSummary } from '../domain';
import { bareJid } from '../identity';

/**
 * Builds a reusable roster index with the same first-match semantics as
 * Array.find(). Normalize bare JIDs once per contact instead of once per
 * conversation row.
 */
export function indexContactsByBareJid(
  contacts: ReadonlyArray<Contact>,
): ReadonlyMap<string, Contact> {
  const index = new Map<string, Contact>();
  for (const contact of contacts) {
    const jid = bareJid(contact.jid);
    if (!index.has(jid)) index.set(jid, contact);
  }
  return index;
}

/** The fallback must preserve the original conversation JID and title. */
export function contactForConversationSummary(
  summary: Pick<ConversationSummary, 'jid' | 'title'>,
  contactsByJid: ReadonlyMap<string, Contact>,
): Contact {
  return (
    contactsByJid.get(bareJid(summary.jid)) || {
      jid: summary.jid,
      name: summary.title,
      groups: [],
      source: 'conversation',
    }
  );
}
