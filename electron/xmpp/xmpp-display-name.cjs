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

/** @param {XmlNode | undefined} card @returns {string | undefined} */
function profileDisplayName(card) {
  const name = card?.getChild('N');
  const candidates = [
    card?.getChildText('FN'),
    [name?.getChildText('GIVEN'), name?.getChildText('FAMILY')].filter(Boolean).join(' '),
    card?.getChildText('NICKNAME'),
  ];
  return candidates
    .filter((value) => typeof value === 'string')
    .map((value) =>
      value
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(/\s+/gu, ' ')
        .trim(),
    )
    .find((value) => value && !value.includes('@'))
    ?.slice(0, 160);
}

/**
 * @param {DisplayNameAdapter} adapter
 * @param {string} accountId
 * @param {DisplayNameSession} session
 * @returns {Promise<void>}
 */
async function loadDisplayName(adapter, accountId, session) {
  try {
    const response = await session.iqCaller.request(
      xml('iq', { type: 'get' }, xml('vCard', { xmlns: 'vcard-temp' })),
      5000,
    );
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

module.exports = { loadDisplayName, profileDisplayName };
