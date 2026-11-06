const { xml } = require('@xmpp/client');

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
      current?.status !== 'connected'
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
