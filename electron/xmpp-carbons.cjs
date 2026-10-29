const crypto = require('node:crypto');
const { xml } = require('@xmpp/client');

const CARBONS_NS = 'urn:xmpp:carbons:2';
const FORWARD_NS = 'urn:xmpp:forward:0';
const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';

function createXmppCarbons(adapter) {
  const states = new Map();

  const stateFor = (accountId) => states.get(accountId);
  const setState = (accountId, state) => states.set(accountId, state);
  const sameBareJid = (left, right) =>
    adapter.bareJid(String(left || '')).toLowerCase() ===
    adapter.bareJid(String(right || '')).toLowerCase();

  const explicitId = (message) =>
    message.attrs.id || message.getChild('origin-id', 'urn:xmpp:sid:0')?.attrs?.id;

  const stableId = (prefix, identity) =>
    `${prefix}_${crypto.createHash('sha256').update(identity).digest('hex')}`;

  const messageFromForwarded = (accountId, wrapper, direction) => {
    const externalSender = wrapper.parent?.attrs?.from;
    if (!sameBareJid(externalSender, accountId)) return null;

    const forwarded = wrapper.getChild('forwarded', FORWARD_NS);
    const original = forwarded?.getChild('message', 'jabber:client');
    if (!original || original.attrs.type === 'groupchat') return null;

    const body = original.getChildText('body');
    const from = String(original.attrs.from || '');
    const to = String(original.attrs.to || '');
    if (!body || !from || !to) return null;

    if (direction === 'received') {
      if (sameBareJid(from, accountId) || !sameBareJid(to, accountId)) return null;
      const conversationId = adapter.bareJid(from);
      const id = explicitId(original);
      const identity = id
        ? `${accountId}|${conversationId}|${id}`
        : `${accountId}|${conversationId}|${crypto.randomUUID()}`;
      const stanzaId = id ? stableId('received', identity) : `received_${crypto.randomUUID()}`;
      return {
        id: `msg_${stanzaId}`,
        accountId,
        conversationId,
        clientMessageId: `received_${stanzaId}`,
        senderJid: conversationId,
        body: { kind: 'text', text: body },
        status: 'sent',
        createdAt: new Date().toISOString(),
      };
    }

    if (!sameBareJid(from, accountId) || sameBareJid(to, accountId)) return null;
    const conversationId = adapter.bareJid(to);
    const id = explicitId(original);
    const stanzaId = id
      ? stableId('sent', `${accountId}|${conversationId}|${id}`)
      : `sent_${crypto.randomUUID()}`;
    return {
      id: `msg_${stanzaId}`,
      accountId,
      conversationId,
      clientMessageId: stanzaId,
      senderJid: accountId,
      body: { kind: 'text', text: body },
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
  };

  return {
    state(accountId) {
      return stateFor(accountId);
    },
    clear(accountId) {
      states.delete(accountId);
    },
    async negotiate(accountId, session, domain, generation) {
      const existing = stateFor(accountId);
      if (existing?.session === session && existing.generation === generation) return existing;
      const pending = { status: 'discovering', session, generation };
      setState(accountId, pending);
      try {
        const discovery = await session.iqCaller.request(
          xml('iq', { type: 'get', to: domain }, xml('query', { xmlns: DISCO_INFO_NS })),
        );
        const query = discovery.getChild('query', DISCO_INFO_NS);
        const supported = Boolean(
          query?.getChildren('feature').some((feature) => feature.attrs.var === CARBONS_NS),
        );
        if (!supported) {
          const unsupported = { status: 'unsupported', session, generation };
          if (stateFor(accountId) === pending) setState(accountId, unsupported);
          return unsupported;
        }

        const result = await session.iqCaller.request(
          xml('iq', { type: 'set' }, xml('enable', { xmlns: CARBONS_NS })),
        );
        if (result.attrs.type !== 'result') throw new Error('CARBONS_ENABLE_NOT_CONFIRMED');
        const enabled = { status: 'enabled', session, generation };
        if (stateFor(accountId) === pending) setState(accountId, enabled);
        return enabled;
      } catch (error) {
        const failed = {
          status: 'unsupported',
          session,
          generation,
          reason: error?.code || error?.message || 'CARBONS_NEGOTIATION_FAILED',
        };
        if (stateFor(accountId) === pending) setState(accountId, failed);
        return failed;
      }
    },
    handleMessage(accountId, stanza) {
      const received = stanza.getChild('received', CARBONS_NS);
      const sent = stanza.getChild('sent', CARBONS_NS);
      if (!received && !sent) return false;
      if (received && sent) return true;
      const message = messageFromForwarded(
        accountId,
        received || sent,
        received ? 'received' : 'sent',
      );
      if (!message) return true;
      adapter.emit({ type: 'message.received', payload: message });
      if (process.env.ATOMIC_XMPP_DEBUG === 'true')
        console.debug(
          '[XMPP_CARBON_RECEIVED]',
          JSON.stringify({ accountId, direction: received ? 'received' : 'sent', id: message.id }),
        );
      return true;
    },
  };
}

module.exports = { CARBONS_NS, DISCO_INFO_NS, FORWARD_NS, createXmppCarbons };
