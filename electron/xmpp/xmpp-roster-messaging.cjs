const crypto = require('node:crypto');
const xmppClient = require('@xmpp/client');
const {
  FALLBACK_NS,
  REPLY_NS,
  SID_NS,
  REACTIONS_NS,
  reactionEmojis,
  reactionEventId,
  reactionTarget,
  referenceFromMessage,
  replyBody,
  replyReference,
  visibleBody,
} = require('./xmpp-message-features.cjs');

const BROADCAST_NAMESPACE = 'urn:atomic-chat:message:broadcast:1';
const JIVE_PROPERTIES_NAMESPACE = 'http://www.jivesoftware.com/xmlns/xmpp/properties';

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, name?: string, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren: (name?: string, namespace?: string) => XmlNode[], getChildText: (name: string, namespace?: string) => string | undefined, getText: () => string | undefined}} XmlNode
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs?: number) => Promise<XmlNode>}, send: (stanza: XmlNode) => Promise<unknown>}} RosterSession
 * @typedef {{jid: string, name?: string, groups: string[], subscription: 'none' | 'to' | 'from' | 'both', ask?: 'subscribe', source: string}} RosterContact
 * @typedef {{messageId?: string, originId?: string, stanzaIds: Array<{id: string, by: string}>, authorJid: string, quote?: string}} MessageReference
 * @typedef {{jid: string, resource: string, type?: string, mode?: string, status?: string, priority: number}} PresenceRecord
 * @typedef {{mode?: string, status?: string, availability?: string}} PresenceInput
 * @typedef {{active: boolean, generation: number | undefined, state: {status: string, selfOccupantJid?: string}, room: {jid: string}}} MucRoomRecord
 * @typedef {{states: Map<string, {status: string}>, sessions: Map<string, RosterSession>, sessionGenerations: Map<string, number | undefined>, rosters: Map<string, Map<string, RosterContact>>, remoteResources: Map<string, Map<string, {mode?: string, status?: string, priority: number}>>, pendingPresences: Map<string, Map<string, PresenceRecord>>, initialPresencePublished: Set<string>, publishedPresences: Map<string, unknown>, mucRooms: Map<string, Map<string, MucRoomRecord>>, require: (accountId: string) => RosterSession, bareJid: (jid: string) => string, emit: (event: unknown) => void, trackReaction: (clientMessageId: string, context: unknown) => void, rejectReaction: (clientMessageId: string, reason: string) => void, applyReaction: (input: unknown) => void}} RosterAdapter
 * @typedef {{body: {kind: 'text', text: string}, to: string, clientMessageId: string, replyTo?: MessageReference, broadcast?: boolean, mode?: string}} MessageInput
 * @typedef {{target: {originId?: string, stanzaIds?: Array<{id?: string}>, messageId?: string}, to: string, clientMessageId: string, targetMessageId?: string, emojis: string[]}} ReactionInput
 * @typedef {{to: string, state: 'active' | 'composing' | 'paused' | 'inactive' | 'gone'}} ChatStateInput
 */

const xml =
  /** @type {(name: string, ...children: Array<XmlAttributes | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

/** @param {string} jid @returns {boolean} */
function isUserJid(jid) {
  return /^[^@/\s]+@[^@/\s]+$/.test(jid);
}

/** @param {XmlNode} stanza @returns {boolean} */
function hasJiveBroadcastProperty(stanza) {
  const properties = stanza.getChild('properties', JIVE_PROPERTIES_NAMESPACE);
  return Boolean(
    properties?.getChildren('property').some((property) => {
      const value = property.getChild('value');
      return (
        property.getChildText('name') === 'broadcast' &&
        value?.attrs?.['type'] === 'boolean' &&
        value?.getText()?.trim().toLowerCase() === 'true'
      );
    }),
  );
}

/**
 * Spark does not expose a broadcast semantic in the XMPP message type. For
 * compatibility, normal/headline messages from a user-shaped bare JID are
 * treated as broadcast. Server JIDs without a localpart remain direct.
 * A service using a localpart-shaped JID can still be a false positive.
 */
/** @param {XmlNode} stanza @param {string} senderJid @returns {'broadcast' | 'direct'} */
function classifyIncomingMessage(stanza, senderJid) {
  if (stanza.getChild('broadcast', BROADCAST_NAMESPACE)) return 'broadcast';
  if (hasJiveBroadcastProperty(stanza)) return 'broadcast';
  if (['normal', 'headline'].includes(stanza.attrs?.['type'] || '') && isUserJid(senderJid))
    return 'broadcast';
  return 'direct';
}

/** @param {RosterAdapter} adapter */
function createRosterMessaging(adapter) {
  const CHAT_STATES_NS = 'http://jabber.org/protocol/chatstates';
  const PENDING_PRESENCE_LIMIT = 512;
  /** @param {string | undefined} mode @returns {string} */
  const availabilityFrom = (mode) =>
    mode === 'away'
      ? 'away'
      : mode === 'xa'
        ? 'extended-away'
        : mode === 'dnd'
          ? 'dnd'
          : 'available';
  /** @param {XmlNode} stanza @returns {string | undefined} */
  const stateFromStanza = (stanza) =>
    ['active', 'composing', 'paused', 'inactive', 'gone'].find((state) =>
      Boolean(stanza.getChild(state, CHAT_STATES_NS)),
    );
  /** @param {XmlNode} stanza @param {string} accountId @returns {PresenceRecord} */
  const presenceRecord = (stanza, accountId) => {
    const from = String(stanza.attrs?.['from'] || accountId);
    return {
      jid: adapter.bareJid(from).toLowerCase(),
      resource: from.split('/')[1] || '_bare',
      type: stanza.attrs?.['type'],
      mode: stanza.getChildText('show') || undefined,
      status: stanza.getChildText('status') || undefined,
      priority: Number.parseInt(stanza.getChildText('priority') || '0', 10) || 0,
    };
  };
  /** @param {string} accountId @param {PresenceRecord} record @returns {boolean} */
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
    /** @param {string} accountId @param {PresenceInput} presence */
    async setPresence(accountId, presence) {
      const session = adapter.require(accountId);
      const generation = adapter.sessionGenerations.get(accountId);
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
      if (
        adapter.sessions.get(accountId) === session &&
        adapter.sessionGenerations.get(accountId) === generation
      ) {
        if (presence.availability === 'unavailable') {
          // General unavailable presence already removes the XMPP occupant.
          adapter.publishedPresences.delete(accountId);
        } else {
          adapter.publishedPresences.set(accountId, {
            mode: presence.mode,
            status: presence.status,
          });
          // XEP-0045 §7.7: existing occupants change availability through
          // directed presence to the room's current full occupant JID.
          for (const record of adapter.mucRooms.get(accountId)?.values() || []) {
            if (
              !record.active ||
              record.state.status !== 'joined' ||
              record.generation !== generation ||
              !record.state.selfOccupantJid
            )
              continue;
            if (
              adapter.sessions.get(accountId) !== session ||
              adapter.sessionGenerations.get(accountId) !== generation ||
              adapter.mucRooms.get(accountId)?.get(record.room.jid.toLowerCase()) !== record
            )
              break;
            await session.send(
              xml(
                'presence',
                { to: record.state.selfOccupantJid },
                presence.mode ? xml('show', {}, presence.mode) : undefined,
                presence.status ? xml('status', {}, presence.status) : undefined,
              ),
            );
          }
        }
      }
      return { jid: accountId, ...presence, updatedAt: new Date().toISOString() };
    },
    /** @param {string} accountId */
    async listRoster(accountId) {
      const session = adapter.require(accountId);
      const result = await session.iqCaller.request(
        xml('iq', { type: 'get' }, xml('query', { xmlns: 'jabber:iq:roster' })),
      );
      const contacts =
        result
          .getChild('query', 'jabber:iq:roster')
          ?.getChildren('item')
          .map((item) => {
            const attrs = item.attrs || {};
            const rawSubscription = attrs['subscription'];
            const subscription = ['none', 'to', 'from', 'both'].includes(rawSubscription || '')
              ? /** @type {'none' | 'to' | 'from' | 'both'} */ (rawSubscription)
              : 'none';
            return {
              jid: adapter.bareJid(attrs['jid'] || '').toLowerCase(),
              name: attrs['name'],
              groups: item
                .getChildren('group')
                .map((group) => group.getText())
                .filter((group) => typeof group === 'string'),
              subscription,
              ...(attrs['ask'] === 'subscribe'
                ? { ask: /** @type {'subscribe'} */ ('subscribe') }
                : {}),
              source: 'roster',
            };
          }) || [];
      const normalized = [
        ...new Map(contacts.map((contact) => [contact.jid.toLowerCase(), contact])).values(),
      ];
      const roster = new Map(normalized.map((contact) => [contact.jid, contact]));
      adapter.rosters.set(accountId, roster);
      const resources = adapter.remoteResources.get(accountId) || new Map();
      for (const key of resources.keys()) {
        const rosterJid = key.split('/')[0] || '';
        if (
          !roster.has(rosterJid) ||
          !['to', 'both'].includes(roster.get(rosterJid)?.subscription || '')
        )
          resources.delete(key);
      }
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
    /** @param {string} accountId @param {MessageInput} input */
    async sendMessage(accountId, input) {
      if (adapter.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
      const session = adapter.require(accountId);
      const composed = replyBody(input.body.text, input.replyTo);
      await session.send(
        xml(
          'message',
          {
            type: input.broadcast && input.mode === 'alert' ? 'headline' : 'chat',
            to: input.to,
            id: input.clientMessageId,
          },
          xml('body', {}, composed.body),
          xml('origin-id', { xmlns: 'urn:xmpp:sid:0', id: input.clientMessageId }),
          ...(input.replyTo
            ? [
                xml('reply', {
                  xmlns: REPLY_NS,
                  id:
                    input.replyTo.originId ||
                    input.replyTo.stanzaIds?.[0]?.id ||
                    input.replyTo.messageId,
                  ...(input.replyTo.authorJid ? { to: input.replyTo.authorJid } : {}),
                }),
                ...(composed.fallback
                  ? [
                      xml(
                        'fallback',
                        { xmlns: FALLBACK_NS, for: REPLY_NS },
                        xml('body', {
                          start: String(composed.fallback.start),
                          end: String(composed.fallback.end),
                        }),
                      ),
                    ]
                  : []),
              ]
            : []),
          ...(input.broadcast ? [xml('broadcast', { xmlns: BROADCAST_NAMESPACE })] : []),
        ),
      );
      return { ...input, status: 'sent', createdAt: new Date().toISOString() };
    },
    /** @param {string} accountId @param {ReactionInput} input */
    async sendReaction(accountId, input) {
      if (adapter.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
      const targetId =
        input.target.originId || input.target.stanzaIds?.[0]?.id || input.target.messageId;
      if (!targetId) throw new Error('INVALID_INPUT');
      adapter.trackReaction(input.clientMessageId, {
        accountId,
        conversationId: input.to,
        targetMessageId: input.targetMessageId || targetId,
        target: input.target,
        actorJid: accountId,
        source: 'direct',
      });
      await adapter.require(accountId).send(
        xml(
          'message',
          {
            type: 'chat',
            to: input.to,
            id: input.clientMessageId,
          },
          xml(
            'reactions',
            { xmlns: REACTIONS_NS, id: targetId },
            ...input.emojis.map((emoji) => xml('reaction', {}, emoji)),
          ),
          xml('origin-id', { xmlns: SID_NS, id: input.clientMessageId }),
        ),
      );
      return { status: 'sent' };
    },
    /** @param {string} accountId @param {ChatStateInput} input */
    async sendChatState(accountId, input) {
      if (adapter.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
      const session = adapter.require(accountId);
      await session.send(
        xml('message', { type: 'chat', to: input.to }, xml(input.state, { xmlns: CHAT_STATES_NS })),
      );
    },
    /** @param {string} accountId @param {XmlNode} stanza */
    handlePresence(accountId, stanza) {
      const type = stanza.attrs?.['type'] || '';
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
    /** @param {string} accountId @param {XmlNode} stanza */
    handleMessage(accountId, stanza) {
      const senderJid = adapter.bareJid(stanza.attrs?.['from'] || accountId);
      if (stanza.attrs?.['type'] === 'error') {
        const condition = stanza
          .getChild('error')
          ?.getChildren()
          ?.find((child) => child.name !== 'text')?.name;
        if (condition === 'not-acceptable' && stanza.attrs?.['id'])
          adapter.rejectReaction(stanza.attrs['id'], condition);
        return true;
      }
      if (
        stanza.attrs?.['type'] === 'groupchat' ||
        senderJid.toLowerCase() === accountId.toLowerCase()
      )
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
      const emojis = reactionEmojis(stanza);
      if (emojis !== undefined) {
        if (emojis === null) return true;
        const target = reactionTarget(stanza, senderJid, undefined);
        if (target)
          adapter.applyReaction({
            accountId,
            conversationId: senderJid,
            target,
            emojis,
            actorJid: senderJid,
            source: 'direct',
            eventId: reactionEventId(stanza),
          });
        return true;
      }
      if (!stanza.getChildText('body')) return Boolean(chatState);
      const bodyText = visibleBody(stanza);
      const explicitId =
        stanza.attrs?.['id'] || stanza.getChild('origin-id', 'urn:xmpp:sid:0')?.attrs?.['id'];
      const identity = `${accountId}|${senderJid}|${explicitId || crypto.randomUUID()}`;
      const stanzaId = explicitId
        ? `received_${crypto.createHash('sha256').update(identity).digest('hex')}`
        : `received_${crypto.randomUUID()}`;
      const classification = classifyIncomingMessage(stanza, senderJid);
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
          classification,
          ...(stanza.attrs?.['id'] ? { messageId: stanza.attrs['id'] } : {}),
          ...(referenceFromMessage(stanza, senderJid, undefined) || {}),
          ...(replyReference(stanza, senderJid, undefined)
            ? { replyTo: replyReference(stanza, senderJid, undefined) }
            : {}),
        },
      });
      if (process.env['ATOMIC_XMPP_DEBUG'] === 'true')
        console.debug(
          '[XMPP_MESSAGE_RECEIVED]',
          JSON.stringify({ accountId, from: senderJid, id: stanzaId, hasBody: true }),
        );
      return true;
    },
  };
}

module.exports = {
  BROADCAST_NAMESPACE,
  JIVE_PROPERTIES_NAMESPACE,
  classifyIncomingMessage,
  createRosterMessaging,
};
