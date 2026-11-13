const REACTIONS_NS = 'urn:xmpp:reactions:0';
const REPLY_NS = 'urn:xmpp:reply:0';
const FALLBACK_NS = 'urn:xmpp:fallback:0';
const SID_NS = 'urn:xmpp:sid:0';
const MAX_REACTIONS = 64;

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{id: string, by: string}} StanzaId
 * @typedef {{messageId?: string, originId?: string, stanzaIds: StanzaId[], authorJid: string, quote?: string}} MessageReference
 * @typedef {{attrs?: XmlAttributes, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren: (name: string, namespace?: string) => XmlNode[], getChildText: (name: string, namespace?: string) => string | undefined, getText: () => string | undefined}} XmlNode
 * @typedef {(item: StanzaId) => boolean} StanzaFilter
 */

/** @param {unknown} value @returns {string} */
function text(value) {
  return typeof value === 'string' ? value : '';
}

/** @param {XmlNode} message @returns {StanzaId[]} */
function stanzaIds(message) {
  return message
    .getChildren('stanza-id', SID_NS)
    .map((item) => ({ id: text(item.attrs?.['id']), by: text(item.attrs?.['by']) }))
    .filter((item) => item.id && item.by);
}

/** @param {XmlNode} message @returns {string | undefined} */
function originId(message) {
  const value = message.getChild('origin-id', SID_NS)?.attrs?.['id'];
  return typeof value === 'string' && value ? value : undefined;
}

/** @param {XmlNode} message @returns {string | undefined} */
function messageId(message) {
  const value = message.attrs?.['id'];
  return typeof value === 'string' && value ? value : undefined;
}

/** @param {string} value @param {number} start @param {number} end @returns {string} */
function codePointSlice(value, start, end) {
  const points = Array.from(value);
  const safeStart = Number.isInteger(start) ? Math.max(0, Math.min(start, points.length)) : 0;
  const safeEnd = Number.isInteger(end)
    ? Math.max(safeStart, Math.min(end, points.length))
    : points.length;
  return points.slice(safeStart, safeEnd).join('');
}

/** @param {XmlNode} message @returns {string | undefined} */
function replyQuote(message) {
  const fallback = message.getChild('fallback', FALLBACK_NS);
  if (fallback?.attrs?.['for'] !== REPLY_NS) return undefined;
  const range = fallback?.getChild('body');
  const body = message.getChildText('body');
  if (!fallback || !range || typeof body !== 'string') return undefined;
  const start = Number.parseInt(range.attrs?.['start'] || '0', 10);
  const end = Number.parseInt(range.attrs?.['end'] || '0', 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start)
    return undefined;
  return codePointSlice(body, start, end).trim() || undefined;
}

/** @param {XmlNode} message @param {string} authorJid @param {StanzaFilter} [stanzaFilter=undefined] @returns {MessageReference | undefined} */
function referenceFromMessage(message, authorJid, stanzaFilter = undefined) {
  const ids = stanzaIds(message).filter((item) => !stanzaFilter || stanzaFilter(item));
  if (!originId(message) && !messageId(message) && !ids.length) return undefined;
  return {
    ...(messageId(message) ? { messageId: messageId(message) } : {}),
    ...(originId(message) ? { originId: originId(message) } : {}),
    stanzaIds: ids,
    authorJid,
  };
}

/** @param {XmlNode} message @param {string} fallbackAuthorJid @param {string | undefined} stanzaBy @returns {MessageReference | undefined} */
function replyReference(message, fallbackAuthorJid, stanzaBy) {
  const reply = message.getChild('reply', REPLY_NS);
  const id = text(reply?.attrs?.['id']);
  if (!id) return undefined;
  return {
    messageId: id,
    stanzaIds: stanzaBy ? [{ id, by: stanzaBy }] : [],
    authorJid: text(reply?.attrs?.['to']) || fallbackAuthorJid,
    ...(replyQuote(message) ? { quote: replyQuote(message) } : {}),
  };
}

/** @param {XmlNode} message @param {string} actorJid @param {StanzaFilter} [stanzaFilter=undefined] @returns {{messageId: string, stanzaIds: StanzaId[], authorJid: string} | undefined} */
function reactionTarget(message, actorJid, stanzaFilter = undefined) {
  const reactions = message.getChild('reactions', REACTIONS_NS);
  const id = text(reactions?.attrs?.['id']);
  if (!reactions || !id) return undefined;
  // The id attribute belongs to the target. Identifiers on this stanza identify
  // the reaction event itself and must never become the target reference.
  return { messageId: id, stanzaIds: [], authorJid: actorJid };
}

/** @param {XmlNode} message @returns {string | undefined} */
function reactionEventId(message) {
  return originId(message) || messageId(message) || stanzaIds(message)[0]?.id;
}

/** @param {XmlNode} message @returns {string | undefined} */
function visibleBody(message) {
  const body = message.getChildText('body');
  if (typeof body !== 'string') return body;
  const fallback = message.getChild('fallback', FALLBACK_NS);
  const range = fallback?.getChild('body');
  if (fallback?.attrs?.['for'] !== REPLY_NS || !range) return body;
  const start = Number.parseInt(range.attrs?.['start'] || '0', 10);
  const end = Number.parseInt(range.attrs?.['end'] || '0', 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return body;
  const points = Array.from(body);
  if (start > points.length || end > points.length) return body;
  let visible = points.slice(0, start).concat(points.slice(end));
  if (visible[start] === '\n') visible = visible.slice(0, start).concat(visible.slice(start + 1));
  return visible.join('');
}

/** @param {XmlNode} message @returns {string[] | null | undefined} */
function reactionEmojis(message) {
  const reactions = message.getChild('reactions', REACTIONS_NS);
  if (!reactions) return undefined;
  const values = reactions
    .getChildren('reaction')
    .map((item) => item.getText())
    .filter((value) => typeof value === 'string');
  const unique = [...new Set(values)];
  if (
    unique.length > MAX_REACTIONS ||
    unique.some(
      (value) =>
        value.length > 64 ||
        !/\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u20E3/u.test(value) ||
        /[\u0000-\u001f\u007f]/u.test(value),
    )
  )
    return null;
  return unique;
}

/** @param {MessageReference | undefined} reference @returns {string | undefined} */
function referenceId(reference) {
  return reference?.originId || reference?.stanzaIds?.[0]?.id || reference?.messageId;
}

/** @param {string} value @returns {number} */
function unicodeLength(value) {
  return Array.from(value).length;
}

/** @param {string} body @param {MessageReference | undefined} reference @returns {{body: string, fallback: {start: number, end: number} | undefined}} */
function replyBody(body, reference) {
  if (!reference?.quote) return { body, fallback: undefined };
  const prefix = `> ${reference.authorJid}: ${reference.quote}`;
  const fallbackEnd = unicodeLength(prefix);
  return { body: `${prefix}\n${body}`, fallback: { start: 0, end: fallbackEnd } };
}

module.exports = {
  FALLBACK_NS,
  REACTIONS_NS,
  REPLY_NS,
  SID_NS,
  MAX_REACTIONS,
  codePointSlice,
  messageId,
  originId,
  reactionEmojis,
  reactionEventId,
  reactionTarget,
  visibleBody,
  referenceFromMessage,
  replyReference,
  referenceId,
  replyBody,
  stanzaIds,
  unicodeLength,
};
