const xmppClient = require('@xmpp/client');

/**
 * @typedef {{attrs?: {[key: string]: string | undefined}, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildText: (name: string, namespace?: string) => string | undefined}} XmlNode
 * @typedef {{states: Map<string, Record<string, unknown>>, sessions: Map<string, unknown>, emit: (event: unknown) => void}} DisplayNameAdapter
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs: number) => Promise<XmlNode>}}} DisplayNameSession
 */

const xml =
  /** @type {(name: string, ...children: Array<Record<string, string | undefined> | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

/** @param {unknown} value @param {number} [maxLength] @returns {string | undefined} */
function profileText(value, maxLength = 160) {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized || undefined;
}

/** @param {XmlNode | undefined} card @returns {string | undefined} */
function profileDisplayName(card) {
  const name = card?.getChild('N');
  const candidates = [
    card?.getChildText('FN'),
    [name?.getChildText('GIVEN'), name?.getChildText('MIDDLE'), name?.getChildText('FAMILY')]
      .filter(Boolean)
      .join(' '),
    card?.getChildText('NICKNAME'),
  ];
  return candidates
    .filter((value) => typeof value === 'string')
    .map((value) => profileText(value))
    .find((value) => value && !value.includes('@'))
    ?.slice(0, 160);
}

/**
 * Requests a vCard-temp card through the session's existing IQ caller.
 * @param {DisplayNameSession} session
 * @param {string | undefined} [to]
 * @param {number} [timeoutMs]
 * @returns {Promise<XmlNode>}
 */
function requestVCard(session, to, timeoutMs = 5000) {
  return session.iqCaller.request(
    xml('iq', { type: 'get', ...(to ? { to } : {}) }, xml('vCard', { xmlns: 'vcard-temp' })),
    timeoutMs,
  );
}

/**
 * Publishes a vCard through the session's existing IQ caller.
 * @param {DisplayNameSession} session
 * @param {XmlNode} card
 * @param {number} [timeoutMs]
 * @returns {Promise<XmlNode>}
 */
function updateVCard(session, card, timeoutMs = 5000) {
  return session.iqCaller.request(xml('iq', { type: 'set' }, card), timeoutMs);
}

/**
 * @param {DisplayNameAdapter} adapter
 * @param {string} accountId
 * @param {DisplayNameSession} session
 * @returns {Promise<void>}
 */
async function loadDisplayName(adapter, accountId, session) {
  try {
    const response = await requestVCard(session);
    const displayName = profileDisplayName(response.getChild('vCard', 'vcard-temp'));
    const current = adapter.states.get(accountId);
    if (
      !displayName ||
      adapter.sessions.get(accountId) !== session ||
      current?.['status'] !== 'connected'
    )
      return;
    const state = { ...current, displayName };
    adapter.states.set(accountId, state);
    adapter.emit({ type: 'connection.stateChanged', payload: state });
  } catch {
    // A missing/unsupported vCard must never prevent login; the UI uses the localpart.
  }
}

module.exports = { loadDisplayName, profileDisplayName, profileText, requestVCard, updateVCard };
