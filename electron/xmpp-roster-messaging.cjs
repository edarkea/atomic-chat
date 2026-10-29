const crypto = require('node:crypto');
const { xml } = require('@xmpp/client');

function createRosterMessaging(adapter) {
  const CHAT_STATES_NS = 'http://jabber.org/protocol/chatstates';
  const PENDING_PRESENCE_LIMIT = 512;
  const availabilityFrom = (mode) =>
    mode === 'away' ? 'away' : mode === 'xa' ? 'extended-away' : mode === 'dnd' ? 'dnd' : 'available';
  const stateFromStanza = (stanza) =>
    ['active', 'composing', 'paused', 'inactive', 'gone'].find(
      (state) => Boolean(stanza.getChild(state, CHAT_STATES_NS)),
    );
  const presenceRecord = (stanza, accountId) => {
    const from = String(stanza.attrs.from || accountId);
    return {
      jid: adapter.bareJid(from).toLowerCase(),
      resource: from.split('/')[1] || '_bare',
      type: stanza.attrs.type,
      mode: stanza.getChildText('show') || undefined,
      status: stanza.getChildText('status') || undefined,
      priority: Number.parseInt(stanza.getChildText('priority') || '0', 10) || 0,
    };
  };
  const applyPresence = (accountId, record) => {
    const roster = adapter.rosters.get(accountId);
    const contact = roster?.get(record.jid);
    if (!contact || !['to', 'both'].includes(contact.subscription)) return true;
    const resources = adapter.remoteResources.get(accountId) || new Map();
    const resourceKey = `${record.jid}/${record.resource}`;
    if (record.type === 'unavailable') resources.delete(resourceKey);
    else
      resources.set(resourceKey, {
        mode: record.mode,
        status: record.status,
        priority: record.priority,
      });
    adapter.remoteResources.set(accountId, resources);
    const active = [...resources.entries()].filter(([key]) => key.startsWith(`${record.jid}/`));
    const latest = active
      .slice()
      .sort((left, right) => (right[1].priority || 0) - (left[1].priority || 0))[0]?.[1];
    adapter.emit({
      type: 'presence.changed',
      payload: {
        accountId,
        jid: record.jid,
        availability: active.length ? availabilityFrom(latest?.mode) : 'unavailable',
        mode: latest?.mode,
        status: latest?.status,
        updatedAt: new Date().toISOString(),
      },
    });
    return true;
  };
  return {
    async setPresence(accountId, presence) {
      const session = adapter.require(accountId);
      const show = presence.mode ? xml('show', {}, presence.mode) : undefined;
      const status = presence.status ? xml('status', {}, presence.status) : undefined;
      await session.send(
        xml(
          'presence',
          { type: presence.availability === 'unavailable' ? 'unavailable' : undefined },
          show,
          status,
        ),
      );
      return { jid: accountId, ...presence, updatedAt: new Date().toISOString() };
    },
    async listRoster(accountId) {
      const session = adapter.require(accountId);
      const result = await session.iqCaller.request(
        xml('iq', { type: 'get' }, xml('query', { xmlns: 'jabber:iq:roster' })),
      );
      const contacts =
        result
          .getChild('query', 'jabber:iq:roster')
          ?.getChildren('item')
          .map((item) => ({
            jid: adapter.bareJid(item.attrs.jid).toLowerCase(),
            name: item.attrs.name,
            groups: item.getChildren('group').map((group) => group.getText()),
            subscription: ['none', 'to', 'from', 'both'].includes(item.attrs.subscription)
              ? item.attrs.subscription
              : 'none',
            ...(item.attrs.ask === 'subscribe' ? { ask: 'subscribe' } : {}),
            source: 'roster',
          })) || [];
      const normalized = [
        ...new Map(contacts.map((contact) => [contact.jid.toLowerCase(), contact])).values(),
      ];
      adapter.rosters.set(accountId, new Map(normalized.map((contact) => [contact.jid, contact])));
      const resources = adapter.remoteResources.get(accountId) || new Map();
      for (const key of resources.keys())
        if (
          !adapter.rosters.get(accountId).has(key.split('/')[0]) ||
          !['to', 'both'].includes(
            adapter.rosters.get(accountId).get(key.split('/')[0]).subscription,
          )
        )
          resources.delete(key);
      adapter.remoteResources.set(accountId, resources);
      const pending = adapter.pendingPresences.get(accountId);
      adapter.pendingPresences.delete(accountId);
      for (const record of pending?.values() || []) applyPresence(accountId, record);
      if (!adapter.initialPresencePublished.has(accountId)) {
        await session.send(xml('presence'));
        adapter.initialPresencePublished.add(accountId);
      }
      return normalized;
    },
    async sendMessage(accountId, input) {
      if (adapter.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
      const session = adapter.require(accountId);
      await session.send(
        xml('message', { type: 'chat', to: input.to }, xml('body', {}, input.body.text)),
      );
      return { ...input, status: 'sent', createdAt: new Date().toISOString() };
    },
    async sendChatState(accountId, input) {
      if (adapter.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
      const session = adapter.require(accountId);
      await session.send(
        xml('message', { type: 'chat', to: input.to }, xml(input.state, { xmlns: CHAT_STATES_NS })),
      );
    },
    handlePresence(accountId, stanza) {
      const type = stanza.attrs.type;
      if (
        ['subscribe', 'subscribed', 'unsubscribe', 'unsubscribed', 'error', 'probe'].includes(type)
      )
        return true;
      const record = presenceRecord(stanza, accountId);
      if (!adapter.rosters.has(accountId)) {
        const pending = adapter.pendingPresences.get(accountId) || new Map();
        const key = `${record.jid}/${record.resource}`;
        if (!pending.has(key) && pending.size >= PENDING_PRESENCE_LIMIT)
          pending.delete(pending.keys().next().value || '');
        pending.set(key, record);
        adapter.pendingPresences.set(accountId, pending);
        return true;
      }
      return applyPresence(accountId, record);
    },
    handleMessage(accountId, stanza) {
      const senderJid = adapter.bareJid(stanza.attrs.from || accountId);
      if (stanza.attrs.type === 'groupchat' || senderJid.toLowerCase() === accountId.toLowerCase())
        return false;
      const chatState = stateFromStanza(stanza);
      if (chatState) {
        adapter.emit({
          type: 'chatState.changed',
          payload: {
            accountId,
            conversationId: senderJid,
            senderJid,
            state: chatState,
          },
        });
      }
      if (!stanza.getChildText('body')) return Boolean(chatState);
      const bodyText = stanza.getChildText('body');
      const explicitId = stanza.attrs.id || stanza.getChild('origin-id')?.attrs?.id;
      const identity = `${accountId}|${senderJid}|${explicitId || crypto.randomUUID()}`;
      const stanzaId = explicitId
        ? `received_${crypto.createHash('sha256').update(identity).digest('hex')}`
        : `received_${crypto.randomUUID()}`;
      adapter.emit({
        type: 'message.received',
        payload: {
          id: `msg_${stanzaId}`,
          accountId,
          conversationId: senderJid,
          clientMessageId: `received_${stanzaId}`,
          senderJid,
          body: { kind: 'text', text: bodyText },
          status: 'sent',
          createdAt: new Date().toISOString(),
        },
      });
      if (process.env.ATOMIC_XMPP_DEBUG === 'true')
        console.debug(
          '[XMPP_MESSAGE_RECEIVED]',
          JSON.stringify({ accountId, from: senderJid, id: stanzaId, hasBody: true }),
        );
      return true;
    },
  };
}

module.exports = { createRosterMessaging };
