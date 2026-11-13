import { Message, MessageReference, RoomMessage } from '../domain';

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Reference matching trims the complete input before splitting to preserve its
// historical handling of pasted direct-message references.
function referenceJid(value: string): string {
  const normalized = value.trim().toLowerCase();
  const slash = normalized.indexOf('/');
  return slash >= 0 ? normalized.slice(0, slash) : normalized;
}

function sameIdentifier(left: string | undefined, right: string | undefined): boolean {
  return present(left) && present(right) && left === right;
}

function sameStanza(
  left: { readonly id?: string; readonly by?: string },
  right: { readonly id?: string; readonly by?: string },
): boolean {
  return (
    present(left.id) &&
    present(left.by) &&
    present(right.id) &&
    present(right.by) &&
    left.id === right.id &&
    referenceJid(left.by) === referenceJid(right.by)
  );
}

function referenceIds(reference: MessageReference): ReadonlyArray<string> {
  return [reference.messageId, reference.originId].filter(present);
}

function messageIds(message: Message | RoomMessage): ReadonlyArray<string> {
  return [
    message.id,
    'clientMessageId' in message ? message.clientMessageId : undefined,
    message.messageId,
    message.originId,
  ].filter(present);
}

function sameAuthor(
  messageAuthor: string | undefined,
  referenceAuthor: string | undefined,
  muc: boolean,
): boolean {
  if (!present(referenceAuthor)) return true;
  if (!present(messageAuthor)) return false;
  return muc
    ? messageAuthor.trim().toLowerCase() === referenceAuthor.trim().toLowerCase()
    : referenceJid(messageAuthor) === referenceJid(referenceAuthor);
}

export function matchesDirectMessageReference(
  message: Message,
  reference: MessageReference,
  accountId: string,
  conversationId: string,
  checkAuthor = true,
): boolean {
  if (message.accountId.trim().toLowerCase() !== accountId.trim().toLowerCase()) return false;
  if (referenceJid(message.conversationId) !== referenceJid(conversationId)) return false;
  if (checkAuthor && !sameAuthor(message.senderJid, reference.authorJid, false)) return false;
  const ids = referenceIds(reference);
  const idMatch = ids.some((referenceId) =>
    messageIds(message).some((messageId) => sameIdentifier(messageId, referenceId)),
  );
  const stanzaMatch =
    message.stanzaIds?.some((messageStanza) =>
      reference.stanzaIds.some((referenceStanza) => sameStanza(messageStanza, referenceStanza)),
    ) || false;
  return idMatch || stanzaMatch;
}

export function matchesRoomMessageReference(
  message: RoomMessage,
  reference: MessageReference,
  accountId: string,
  roomJid: string,
  checkAuthor = true,
): boolean {
  if (message.accountId.trim().toLowerCase() !== accountId.trim().toLowerCase()) return false;
  if (referenceJid(message.roomJid) !== referenceJid(roomJid)) return false;
  if (checkAuthor && !sameAuthor(message.occupantJid, reference.authorJid, true)) return false;
  const room = referenceJid(roomJid);
  const roomStanzaMatch =
    message.stanzaIds?.some((messageStanza) =>
      reference.stanzaIds.some(
        (referenceStanza) =>
          referenceJid(referenceStanza.by) === room && sameStanza(messageStanza, referenceStanza),
      ),
    ) || false;
  if (roomStanzaMatch) return true;
  const ids = referenceIds(reference);
  return ids.some((referenceId) =>
    messageIds(message).some((messageId) => sameIdentifier(messageId, referenceId)),
  );
}
