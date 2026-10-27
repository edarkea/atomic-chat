const { client, xml } = require('@xmpp/client');
const { validateXmppTransport } = require('./security-policy.cjs');

class XmppAdapter {
  constructor() { this.sessions = new Map(); this.states = new Map(); this.listeners = new Set(); this.recentIncoming = new Map(); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async connect(input, password) {
    if (!password) throw new Error('secret_unavailable');
    const transport = validateXmppTransport(input.endpoint);
    this.states.set(input.accountId, { accountId: input.accountId, status: 'connecting', retryable: true, since: new Date().toISOString() });
    const session = client({
      service: `${transport.tls ? 'xmpps' : 'xmpp'}://${transport.host}:${transport.port}`,
      domain: input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host,
      username: input.accountId.split('@')[0],
      password,
      tls: { rejectUnauthorized: transport.rejectUnauthorized },
    });
    this.states.set(input.accountId, { accountId: input.accountId, status: 'authenticating', retryable: true, since: new Date().toISOString() });
    session.on('error', (error) => { this.setState(input.accountId, 'failed', true, error.code || 'TRANSPORT_FAILED'); });
    session.on('offline', () => { this.sessions.delete(input.accountId); this.setState(input.accountId, 'failed', true, 'offline'); });
    session.on('online', () => { this.setState(input.accountId, 'connected', false); });
    session.on('stanza', (stanza) => this.handleStanza(input.accountId, stanza));
    try { await session.start(); } catch (error) { this.setState(input.accountId, 'failed', true, error.code || 'TRANSPORT_FAILED'); throw error; }
    this.sessions.set(input.accountId, session);
    const state = { accountId: input.accountId, status: 'connected', retryable: false, since: new Date().toISOString() }; this.states.set(input.accountId, state); return state;
  }

  async disconnect(accountId) {
    const session = this.sessions.get(accountId);
    this.states.set(accountId, { accountId, status: 'disconnecting', retryable: false, since: new Date().toISOString() });
    if (session) await session.stop();
    this.sessions.delete(accountId);
    this.states.set(accountId, { accountId, status: 'idle', retryable: false, since: new Date().toISOString() });
  }

  async setPresence(accountId, presence) {
    const session = this.require(accountId);
    await session.send(xml('presence', { type: presence.availability === 'unavailable' ? 'unavailable' : undefined }, presence.status ? xml('status', {}, presence.status) : undefined));
    return { jid: accountId, ...presence, updatedAt: new Date().toISOString() };
  }

  async listRoster(accountId) {
    const session = this.require(accountId);
    const result = await session.iqCaller.request(xml('iq', { type: 'get' }, xml('query', { xmlns: 'jabber:iq:roster' })));
    return result.getChild('query', 'jabber:iq:roster')?.getChildren('item').map((item) => ({ jid: item.attrs.jid, name: item.attrs.name, groups: item.getChildren('group').map((group) => group.getText()) })) || [];
  }

  async sendMessage(accountId, input) {
    if (this.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
    const session = this.require(accountId);
    await session.send(xml('message', { type: 'chat', to: input.to }, xml('body', {}, input.body.text)));
    return { ...input, status: 'sent', createdAt: new Date().toISOString() };
  }

  handleStanza(accountId, stanza) {
    if (stanza.is('presence')) {
      this.emit({ type: 'presence.changed', payload: { jid: this.bareJid(stanza.attrs.from || accountId), availability: stanza.attrs.type === 'unavailable' ? 'unavailable' : 'available', updatedAt: new Date().toISOString() } });
    }
    if (stanza.is('message') && stanza.getChildText('body')) {
      const senderJid = this.bareJid(stanza.attrs.from || accountId);
      const bodyText = stanza.getChildText('body');
      const explicitId = stanza.attrs.id || stanza.getChild('origin-id')?.attrs?.id;
      const fingerprint = `${senderJid}|${bodyText}|${Math.floor(Date.now() / 2000)}`;
      if (!explicitId && this.recentIncoming.has(fingerprint)) return;
      if (!explicitId) this.recentIncoming.set(fingerprint, Date.now());
      const stanzaId = explicitId || `received_${Buffer.from(fingerprint).toString('hex').slice(0, 32)}`;
      this.emit({ type: 'message.received', payload: { id: `msg_${stanzaId}`, accountId, conversationId: senderJid, clientMessageId: `received_${stanzaId}`, senderJid, body: { kind: 'text', text: bodyText }, status: 'sent', createdAt: new Date().toISOString() } });
    }
  }

  bareJid(jid) { return String(jid).split('/')[0]; }

  emit(event) { this.listeners.forEach((listener) => listener(event)); }

  require(accountId) { const session = this.sessions.get(accountId); if (!session) throw new Error('not_connected'); return session; }
  setState(accountId, status, retryable, reason) { const state = { accountId, status, retryable, since: new Date().toISOString(), ...(reason ? { reason } : {}) }; this.states.set(accountId, state); this.emit({ type: 'connection.stateChanged', payload: state }); }
}

module.exports = { XmppAdapter };
