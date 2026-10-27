const { client, xml } = require('@xmpp/client');
const crypto = require('node:crypto');
const { validateXmppTransport } = require('./security-policy.cjs');

class XmppAdapter {
  constructor(packaged = false) { this.packaged = packaged; this.sessions = new Map(); this.states = new Map(); this.listeners = new Set(); this.connecting = new Map(); this.rosters = new Map(); this.remoteResources = new Map(); this.initialPresencePublished = new Set(); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async connect(input, password) {
    const current = this.connecting.get(input.accountId);
    if (current) return current;
    if (this.sessions.has(input.accountId)) await this.disconnect(input.accountId);
    const operation = this.connectInternal(input, password);
    this.connecting.set(input.accountId, operation);
    try { return await operation; } finally { if (this.connecting.get(input.accountId) === operation) this.connecting.delete(input.accountId); }
  }

  async connectInternal(input, password) {
    if (!password) throw new Error('secret_unavailable');
    const transport = validateXmppTransport(input.endpoint, this.packaged);
    this.states.set(input.accountId, { accountId: input.accountId, status: 'connecting', retryable: true, since: new Date().toISOString() });
    const session = client({
      service: `${transport.tls ? 'xmpps' : 'xmpp'}://${transport.host}:${transport.port}`,
      domain: input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host,
      username: input.accountId.split('@')[0],
      password,
      tls: { rejectUnauthorized: transport.rejectUnauthorized },
    });
    this.states.set(input.accountId, { accountId: input.accountId, status: 'authenticating', retryable: true, since: new Date().toISOString() });
    session.on('error', (error) => { this.handleSessionEvent(input.accountId, session, 'error', error.code || 'TRANSPORT_FAILED'); });
    session.on('offline', () => { this.handleSessionEvent(input.accountId, session, 'offline'); });
    session.on('online', () => { this.handleSessionEvent(input.accountId, session, 'online'); });
    session.on('stanza', (stanza) => this.handleStanza(input.accountId, stanza));
    try { await session.start(); } catch (error) { this.setState(input.accountId, 'failed', true, error.code || 'TRANSPORT_FAILED'); throw error; }
    this.remoteResources.set(input.accountId, new Map()); this.initialPresencePublished.delete(input.accountId); this.sessions.set(input.accountId, session);
    const state = { accountId: input.accountId, status: 'connected', retryable: false, since: new Date().toISOString() }; this.states.set(input.accountId, state); return state;
  }

  async disconnect(accountId) {
    const session = this.sessions.get(accountId);
    this.states.set(accountId, { accountId, status: 'disconnecting', retryable: false, since: new Date().toISOString() });
    if (session) await session.stop();
    this.sessions.delete(accountId);
    this.rosters.delete(accountId); this.remoteResources.delete(accountId); this.initialPresencePublished.delete(accountId);
    this.states.set(accountId, { accountId, status: 'idle', retryable: false, since: new Date().toISOString() });
  }

  async setPresence(accountId, presence) {
    const session = this.require(accountId);
    const show = presence.mode ? xml('show', {}, presence.mode) : undefined;
    const status = presence.status ? xml('status', {}, presence.status) : undefined;
    await session.send(xml('presence', { type: presence.availability === 'unavailable' ? 'unavailable' : undefined }, show, status));
    return { jid: accountId, ...presence, updatedAt: new Date().toISOString() };
  }

  async listRoster(accountId) {
    const session = this.require(accountId);
    const result = await session.iqCaller.request(xml('iq', { type: 'get' }, xml('query', { xmlns: 'jabber:iq:roster' })));
    const contacts = result.getChild('query', 'jabber:iq:roster')?.getChildren('item').map((item) => ({ jid: this.bareJid(item.attrs.jid), name: item.attrs.name, groups: item.getChildren('group').map((group) => group.getText()), subscription: ['none', 'to', 'from', 'both'].includes(item.attrs.subscription) ? item.attrs.subscription : 'none', ...(item.attrs.ask === 'subscribe' ? { ask: 'subscribe' } : {}), source: 'roster' })) || [];
    const normalized = [...new Map(contacts.map((contact) => [contact.jid.toLowerCase(), contact])).values()]; this.rosters.set(accountId, new Map(normalized.map((contact) => [contact.jid, contact]))); const resources = this.remoteResources.get(accountId) || new Map(); for (const key of resources.keys()) if (!this.rosters.get(accountId).has(key.split('/')[0]) || !['to', 'both'].includes(this.rosters.get(accountId).get(key.split('/')[0]).subscription)) resources.delete(key); this.remoteResources.set(accountId, resources); if (!this.initialPresencePublished.has(accountId)) { await session.send(xml('presence')); this.initialPresencePublished.add(accountId); } return normalized;
  }

  async sendMessage(accountId, input) {
    if (this.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
    const session = this.require(accountId);
    await session.send(xml('message', { type: 'chat', to: input.to }, xml('body', {}, input.body.text)));
    return { ...input, status: 'sent', createdAt: new Date().toISOString() };
  }

  handleStanza(accountId, stanza) {
    if (process.env.ATOMIC_XMPP_DEBUG === 'true') console.debug('[XMPP_STANZA]', JSON.stringify({ accountId, from: stanza.attrs?.from || '', to: stanza.attrs?.to || '', type: stanza.name || stanza.attrs?.type || '', id: stanza.attrs?.id || '', hasBody: Boolean(stanza.getChildText?.('body')) }));
    if (stanza.is('presence')) {
      const type = stanza.attrs.type; if (['subscribe', 'subscribed', 'unsubscribe', 'unsubscribed', 'error', 'probe'].includes(type)) return;
      const jid = this.bareJid(stanza.attrs.from || accountId); const contact = this.rosters.get(accountId)?.get(jid); if (!contact || !['to', 'both'].includes(contact.subscription)) return;
      const resource = String(stanza.attrs.from || '').split('/')[1] || '_bare'; const resources = this.remoteResources.get(accountId) || new Map(); if (type === 'unavailable') resources.delete(jid + '/' + resource); else resources.set(jid + '/' + resource, { mode: stanza.getChildText('show') || undefined, status: stanza.getChildText('status') || undefined }); this.remoteResources.set(accountId, resources);
      const active = [...resources.entries()].filter(([key]) => key.startsWith(`${jid}/`)); const latest = active[active.length - 1]?.[1]; this.emit({ type: 'presence.changed', payload: { accountId, jid, availability: active.length ? 'available' : 'unavailable', mode: latest?.mode, status: latest?.status, updatedAt: new Date().toISOString() } });
    }
    if (stanza.is('message') && stanza.getChildText('body')) {
      const senderJid = this.bareJid(stanza.attrs.from || accountId);
      const bodyText = stanza.getChildText('body');
      const explicitId = stanza.attrs.id || stanza.getChild('origin-id')?.attrs?.id;
      const identity = `${accountId}|${senderJid}|${explicitId || crypto.randomUUID()}`;
      const stanzaId = explicitId ? `received_${crypto.createHash('sha256').update(identity).digest('hex')}` : `received_${crypto.randomUUID()}`;
      this.emit({ type: 'message.received', payload: { id: `msg_${stanzaId}`, accountId, conversationId: senderJid, clientMessageId: `received_${stanzaId}`, senderJid, body: { kind: 'text', text: bodyText }, status: 'sent', createdAt: new Date().toISOString() } });
      if (process.env.ATOMIC_XMPP_DEBUG === 'true') console.debug('[XMPP_MESSAGE_RECEIVED]', JSON.stringify({ accountId, from: senderJid, id: stanzaId, hasBody: true }));
    }
  }

  bareJid(jid) { return String(jid).split('/')[0]; }

  emit(event) { this.listeners.forEach((listener) => listener(event)); }

  require(accountId) { const session = this.sessions.get(accountId); if (!session) throw new Error('not_connected'); return session; }
  setState(accountId, status, retryable, reason) { const state = { accountId, status, retryable, since: new Date().toISOString(), ...(reason ? { reason } : {}) }; this.states.set(accountId, state); this.emit({ type: 'connection.stateChanged', payload: state }); }
  handleSessionEvent(accountId, session, event, reason) { if (this.sessions.get(accountId) !== session) return false; if (event === 'offline') { this.sessions.delete(accountId); this.setState(accountId, 'failed', true, 'offline'); } else if (event === 'error') this.setState(accountId, 'failed', true, reason || 'TRANSPORT_FAILED'); else if (event === 'online') this.setState(accountId, 'connected', false); return true; }
}

module.exports = { XmppAdapter };
