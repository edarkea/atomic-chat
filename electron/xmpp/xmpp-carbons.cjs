const crypto = require('node:crypto');
const xmppClient = require('@xmpp/client');
const {
  REACTIONS_NS,
  reactionEmojis,
  reactionEventId,
  reactionTarget,
  referenceFromMessage,
  replyReference,
  visibleBody,
} = require('./xmpp-message-features.cjs');

const CARBONS_NS = 'urn:xmpp:carbons:2';
const FORWARD_NS = 'urn:xmpp:forward:0';
const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, parent?: XmlNode, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren: (name: string, namespace?: string) => XmlNode[], getChildText: (name: string, namespace?: string) => string | undefined, getText: () => string | undefined}} XmlNode
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs?: number) => Promise<XmlNode>}}} XmppSession
 * @typedef {{messageId: string, stanzaIds: Array<{id: string, by?: string}>, authorJid: string}} ReactionTarget
 * @typedef {{actorJid: string, conversationId: string, target: ReactionTarget, emojis: string[], eventId?: string}} ReactionData
 * @typedef {{sticker?: unknown, reaction?: ReactionData, id?: string, accountId?: string, conversationId?: string, body?: {kind: 'text', text: string}, status?: string, createdAt?: string, clientMessageId?: string, senderJid?: string}} CarbonMessage
 * @typedef {{status: string, session: XmppSession, generation: number | undefined, reason?: string}} CarbonState
 * @typedef {{bareJid: (jid: string) => string, parseStickerMessage?: (accountId: string, stanza: XmlNode, direction: 'received' | 'sent') => unknown, emit: (event: unknown) => void, applyReaction: (input: {accountId: string, conversationId: string, target: ReactionTarget, emojis: string[], actorJid: string, source: 'direct', eventId?: string}) => void}} CarbonAdapter
 */

const xml =
  /** @type {(name: string, ...children: Array<XmlAttributes | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

/** @param {CarbonAdapter} adapter */
function createXmppCarbons(adapter) {
  /** @type {Map<string, CarbonState>} */
  const states = new Map();

  /** @param {string} accountId @returns {CarbonState | undefined} */
  const stateFor = (accountId) => states.get(accountId);
  /** @param {string} accountId @param {CarbonState} state @returns {CarbonState} */
  const setState = (accountId, state) => {
    states.set(accountId, state);
    return state;
  };
  /** @param {unknown} left @param {unknown} right @returns {boolean} */
  const sameBareJid = (left, right) =>
    adapter.bareJid(String(left || '')).toLowerCase() ===
    adapter.bareJid(String(right || '')).toLowerCase();

  /** @param {XmlNode} message @returns {string | undefined} */
  const explicitId = (message) =>
    message.attrs?.['id'] || message.getChild('origin-id', 'urn:xmpp:sid:0')?.attrs?.['id'];

  /** @param {string} prefix @param {string} identity @returns {string} */
  const stableId = (prefix, identity) =>
    `${prefix}_${crypto.createHash('sha256').update(identity).digest('hex')}`;

  /** @param {string} accountId @param {XmlNode} wrapper @param {'received' | 'sent'} direction @returns {CarbonMessage | null} */
  const messageFromForwarded = (accountId, wrapper, direction) => {
    const externalSender = wrapper.parent?.attrs?.['from'];
    if (!sameBareJid(externalSender, accountId)) return null;

    const forwarded = wrapper.getChild('forwarded', FORWARD_NS);
    const original = forwarded?.getChild('message', 'jabber:client');
    if (!original || original.attrs?.['type'] === 'groupchat') return null;

    let sticker;
    try {
      sticker = adapter.parseStickerMessage?.(accountId, original, direction);
    } catch (error) {
      if (process.env['ATOMIC_XMPP_DEBUG'] === 'true')
        console.warn(
          '[XMPP_CARBON_STICKER] Ignoring invalid sticker stanza:',
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : error && typeof error === 'object' && 'message' in error
              ? error.message
              : undefined,
        );
      return null;
    }
    if (sticker) return { sticker };

    const body = visibleBody(original);
    const from = String(original.attrs?.['from'] || '');
    const to = String(original.attrs?.['to'] || '');
    if (!from || !to) return null;
    const emojis = reactionEmojis(original);
    if (emojis !== undefined) {
      if (emojis === null) return null;
      const actor = direction === 'received' ? from : from;
      const target = reactionTarget(original, actor, undefined);
      return target
        ? {
            reaction: {
              actorJid: actor,
              conversationId: adapter.bareJid(direction === 'received' ? from : to),
              target,
              emojis,
              eventId: reactionEventId(original),
            },
          }
        : null;
    }
    if (!body) return null;

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
        ...(referenceFromMessage(original, conversationId, undefined) || {}),
        ...(replyReference(original, conversationId, undefined)
          ? { replyTo: replyReference(original, conversationId, undefined) }
          : {}),
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
      ...(referenceFromMessage(original, accountId, undefined) || {}),
      ...(replyReference(original, accountId, undefined)
        ? { replyTo: replyReference(original, accountId, undefined) }
        : {}),
    };
  };

  return {
    /** @param {string} accountId @returns {CarbonState | undefined} */
    state(accountId) {
      return stateFor(accountId);
    },
    /** @param {string} accountId */
    clear(accountId) {
      states.delete(accountId);
    },
    /** @param {string} accountId @param {unknown} session @param {string} domain @param {number | undefined} generation */
    async negotiate(accountId, session, domain, generation) {
      const typedSession = /** @type {XmppSession} */ (session);
      const existing = stateFor(accountId);
      if (existing?.session === typedSession && existing.generation === generation) return existing;
      const pending = { status: 'discovering', session: typedSession, generation };
      setState(accountId, pending);
      try {
        const discovery = await typedSession.iqCaller.request(
          xml('iq', { type: 'get', to: domain }, xml('query', { xmlns: DISCO_INFO_NS })),
        );
        const query = discovery.getChild('query', DISCO_INFO_NS);
        const supported = Boolean(
          query?.getChildren('feature').some((feature) => feature.attrs?.['var'] === CARBONS_NS),
        );
        if (!supported) {
          const unsupported = { status: 'unsupported', session: typedSession, generation };
          if (stateFor(accountId) === pending) setState(accountId, unsupported);
          return unsupported;
        }

        const result = await typedSession.iqCaller.request(
          xml('iq', { type: 'set' }, xml('enable', { xmlns: CARBONS_NS })),
        );
        if (result.attrs?.['type'] !== 'result') throw new Error('CARBONS_ENABLE_NOT_CONFIRMED');
        const enabled = { status: 'enabled', session: typedSession, generation };
        if (stateFor(accountId) === pending) setState(accountId, enabled);
        return enabled;
      } catch (error) {
        const failed = {
          status: 'unsupported',
          session: typedSession,
          generation,
          reason:
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
              ? error.code
              : error &&
                  typeof error === 'object' &&
                  'message' in error &&
                  typeof error.message === 'string'
                ? error.message
                : 'CARBONS_NEGOTIATION_FAILED',
        };
        if (stateFor(accountId) === pending) setState(accountId, failed);
        return failed;
      }
    },
    /** @param {string} accountId @param {XmlNode} stanza @returns {boolean} */
    handleMessage(accountId, stanza) {
      const received = stanza.getChild('received', CARBONS_NS);
      const sent = stanza.getChild('sent', CARBONS_NS);
      if (!received && !sent) return false;
      if (received && sent) return true;
      const wrapper = received || sent;
      if (!wrapper) return true;
      const message = messageFromForwarded(accountId, wrapper, received ? 'received' : 'sent');
      if (!message) return true;
      if (message.sticker) {
        adapter.emit({ type: 'sticker.messageReceived', payload: message.sticker });
        return true;
      }
      if (message.reaction) {
        const conversationId = message.reaction.conversationId;
        if (conversationId)
          adapter.applyReaction({
            accountId,
            conversationId,
            target: message.reaction.target,
            emojis: message.reaction.emojis,
            actorJid: message.reaction.actorJid,
            source: 'direct',
            eventId: message.reaction.eventId,
          });
        return true;
      }
      adapter.emit({ type: 'message.received', payload: message });
      if (process.env['ATOMIC_XMPP_DEBUG'] === 'true')
        console.debug(
          '[XMPP_CARBON_RECEIVED]',
          JSON.stringify({
            accountId,
            direction: received ? 'received' : 'sent',
            id: 'id' in message ? message.id : undefined,
          }),
        );
      return true;
    },
  };
}

module.exports = { CARBONS_NS, DISCO_INFO_NS, FORWARD_NS, createXmppCarbons };
