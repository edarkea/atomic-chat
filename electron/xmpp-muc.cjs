const crypto = require('node:crypto');
const { xml } = require('@xmpp/client');

const DISCO_ITEMS_NS = 'http://jabber.org/protocol/disco#items';
const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';
const MUC_NS = 'http://jabber.org/protocol/muc';
const MUC_USER_NS = 'http://jabber.org/protocol/muc#user';
const DELAY_NS = 'urn:xmpp:delay';
const LEGACY_DELAY_NS = 'jabber:x:delay';
const MUC_TEXT_LIMIT_BYTES = 4096;
const MUC_MESSAGE_BUFFER_LIMIT = 200;
const MUC_ROOM_LIMIT = 5;

function taggedError(code, message, phase) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  return error;
}

function createMucService(adapter) {
  return {
    setMucPolicy(policy) {
      if (
        !policy ||
        typeof policy.accountId !== 'string' ||
        typeof policy.service !== 'string' ||
        policy.canCreate !== false ||
        policy.source !== 'operator' ||
        typeof policy.evidence !== 'string' ||
        !policy.evidence.trim() ||
        !policy.endpoint ||
        typeof policy.endpoint.host !== 'string' ||
        !policy.endpoint.host.trim() ||
        !Number.isInteger(policy.endpoint.port) ||
        !['starttls', 'direct-tls'].includes(policy.endpoint.transport)
      )
        return false;
      adapter.mucPolicies.set(
        adapter.mucPolicyKey(policy.accountId, policy.service, policy.endpoint),
        { ...policy, endpoint: { ...policy.endpoint } },
      );
      return true;
    },
    async discoverMuc(input) {
      adapter.assertMucRequest(input);
      const session = adapter.requireConnected(input.accountId);
      const generation = adapter.sessionGenerations.get(input.accountId) || 0;
      const domain = adapter.sessionDomains.get(input.accountId) || '';
      const request = adapter.withTimeout(
        adapter.discoverServices(session, input.accountId, () =>
          adapter.assertSessionCurrent(input.accountId, session, generation, domain),
        ),
        10000,
        'TIMEOUT',
        'El descubrimiento MUC excedió el tiempo límite.',
      );
      const rooms = await request;
      adapter.assertSessionCurrent(input.accountId, session, generation, domain);
      const accreditedRooms = rooms.map((room) => ({
        ...room,
        discoveryGeneration: generation,
        discoveryDomain: domain,
        discoveryEndpoint: adapter.sessionEndpoints.get(input.accountId),
      }));
      adapter.mucDiscoveries.set(
        input.accountId,
        new Map(accreditedRooms.map((room) => [room.jid.toLowerCase(), room])),
      );
      return accreditedRooms;
    },
    async discoverServices(session, accountId, guard = () => undefined) {
      const domain =
        adapter.sessionDomains.get(accountId) ||
        process.env.ATOMIC_XMPP_DOMAIN ||
        accountId.split('@')[1];
      const items = await adapter.discoItems(session, domain);
      guard();
      const services = [];
      for (const item of items) {
        const jid = adapter.bareJid(item.attrs.jid || '');
        if (!jid) continue;
        const info = await adapter.discoInfo(session, jid);
        guard();
        const identities = info.getChild('query', DISCO_INFO_NS)?.getChildren('identity') || [];
        const features = info.getChild('query', DISCO_INFO_NS)?.getChildren('feature') || [];
        if (
          !identities.some(
            (identity) =>
              identity.attrs.category === 'conference' && identity.attrs.type === 'text',
          ) ||
          !features.some((feature) => feature.attrs.var === MUC_NS)
        )
          continue;
        services.push(jid);
      }
      const rooms = [];
      for (const service of services) {
        const visible = await adapter.discoItems(session, service);
        guard();
        for (const item of visible) {
          const jid = adapter.bareJid(item.attrs.jid || '');
          if (!jid || !jid.endsWith(`@${service}`) || jid.includes('/')) continue;
          rooms.push({ service, room: jid.slice(0, -service.length - 1), jid });
        }
      }
      return [...new Map(rooms.map((room) => [room.jid.toLowerCase(), room])).values()];
    },
    async discoItems(session, to) {
      const result = await session.iqCaller.request(
        xml('iq', { type: 'get', to }, xml('query', { xmlns: DISCO_ITEMS_NS })),
      );
      const query = result.getChild('query', DISCO_ITEMS_NS);
      if (!query)
        throw taggedError(
          'TRANSPORT_FAILED',
          'La respuesta de descubrimiento está incompleta.',
          'muc.discovery',
        );
      return query.getChildren('item');
    },
    async discoInfo(session, to) {
      const result = await session.iqCaller.request(
        xml('iq', { type: 'get', to }, xml('query', { xmlns: DISCO_INFO_NS })),
      );
      if (!result.getChild('query', DISCO_INFO_NS))
        throw taggedError(
          'TRANSPORT_FAILED',
          'La respuesta de identidad MUC está incompleta.',
          'muc.discovery',
        );
      return result;
    },
    async joinMuc(input) {
      adapter.assertMucRequest(input);
      const roomJid = adapter.validateRoomJid(input.roomJid);
      const nickname = adapter.validateNickname(input.nickname);
      const session = adapter.requireConnected(input.accountId);
      const discovered = adapter.mucDiscoveries.get(input.accountId)?.get(roomJid.toLowerCase());
      if (!discovered || discovered.service !== adapter.bareJid(roomJid).split('@')[1])
        throw taggedError(
          'UNAUTHORIZED',
          'La sala no fue descubierta en el servicio seleccionado.',
          'muc.join',
        );
      const generation = adapter.sessionGenerations.get(input.accountId) || 0;
      const currentDomain = adapter.sessionDomains.get(input.accountId) || '';
      const endpoint = adapter.sessionEndpoints.get(input.accountId);
      const policy = adapter.mucPolicies.get(
        adapter.mucPolicyKey(input.accountId, discovered.service, endpoint),
      );
      if (!policy)
        throw taggedError(
          'UNAUTHORIZED',
          'La entrada requiere acreditación administrativa de que la cuenta no puede crear salas.',
          'muc.policy',
        );
      if (
        discovered.discoveryGeneration !== generation ||
        discovered.discoveryDomain !== currentDomain ||
        JSON.stringify(discovered.discoveryEndpoint) !== JSON.stringify(endpoint) ||
        discovered.service !== adapter.bareJid(roomJid).split('@')[1]
      )
        throw taggedError('UNAUTHORIZED', 'La evidencia de la sala está obsoleta.', 'muc.join');
      const roomInfo = await adapter.discoInfo(session, roomJid);
      adapter.assertSessionCurrent(input.accountId, session, generation, currentDomain);
      const roomQuery = roomInfo.getChild('query', DISCO_INFO_NS);
      if (!roomQuery || !roomQuery.getChildren('identity').length)
        throw taggedError('UNAUTHORIZED', 'La sala ya no está disponible.', 'muc.join');
      const rooms = adapter.mucRooms.get(input.accountId) || new Map();
      const active = [...rooms.values()].filter((room) =>
        ['joining', 'joined', 'leaving'].includes(room.state.status),
      ).length;
      if (active >= MUC_ROOM_LIMIT)
        throw taggedError('CONFLICT', 'Se alcanzó el máximo de salas simultáneas.', 'muc.join');
      if (
        rooms.get(roomJid.toLowerCase())?.state.status === 'joining' ||
        rooms.get(roomJid.toLowerCase())?.state.status === 'joined'
      )
        throw taggedError('CONFLICT', 'La cuenta ya está en esta sala.', 'muc.join');
      const record = adapter.createMucRoom(
        input.accountId,
        discovered,
        generation,
        nickname,
        input.requestId,
      );
      rooms.set(roomJid.toLowerCase(), record);
      adapter.mucRooms.set(input.accountId, rooms);
      adapter.emitMucState(record, input.requestId);
      const presence = xml(
        'presence',
        { to: `${roomJid}/${nickname}` },
        xml('x', { xmlns: MUC_NS }, xml('history', { maxstanzas: '0' })),
      );
      try {
        adapter.assertSessionCurrent(input.accountId, session, generation, currentDomain);
        await session.send(presence);
        return await adapter.withTimeout(
          record.joinPromise,
          15000,
          'TIMEOUT',
          'La entrada a la sala excedió el tiempo límite.',
        );
      } catch (error) {
        adapter.failMucRoom(record, error);
        throw error;
      }
    },
    async leaveMuc(input) {
      adapter.assertMucRequest(input);
      const roomJid = adapter.validateRoomJid(input.roomJid);
      const record = adapter.mucRooms.get(input.accountId)?.get(roomJid.toLowerCase());
      if (!record || record.state.status !== 'joined')
        throw taggedError('CONFLICT', 'La cuenta no está dentro de esta sala.', 'muc.leave');
      record.state = { ...record.state, status: 'leaving' };
      record.leaveRequestId = input.requestId;
      adapter.emitMucState(record, input.requestId);
      const session = adapter.requireConnected(input.accountId);
      try {
        await session.send(
          xml('presence', {
            to: record.state.selfOccupantJid || `${roomJid}/${record.nickname}`,
            type: 'unavailable',
          }),
        );
        return await adapter.withTimeout(
          record.leavePromise,
          15000,
          'TIMEOUT',
          'La salida de la sala no fue confirmada.',
        );
      } catch (error) {
        if (record.state.status === 'leaving') {
          record.state = {
            ...record.state,
            status: 'leaving',
            errorCode: error.code || 'TRANSPORT_FAILED',
          };
          adapter.emitMucState(record, input.requestId);
        }
        throw error;
      }
    },
    async sendMucMessage(input) {
      adapter.assertMucRequest(input);
      const roomJid = adapter.validateRoomJid(input.roomJid);
      if (
        !input.clientMessageId ||
        typeof input.clientMessageId !== 'string' ||
        input.clientMessageId.length > 512 ||
        input.body?.kind !== 'text' ||
        typeof input.body.text !== 'string' ||
        !input.body.text.trim()
      )
        throw taggedError('INVALID_INPUT', 'El mensaje MUC no es válido.', 'muc.send');
      if (Buffer.byteLength(input.body.text, 'utf8') > MUC_TEXT_LIMIT_BYTES)
        throw taggedError(
          'INVALID_INPUT',
          'El mensaje supera el límite de 4096 bytes UTF-8.',
          'muc.send',
        );
      const record = adapter.mucRooms.get(input.accountId)?.get(roomJid.toLowerCase());
      if (!record || record.state.status !== 'joined')
        throw taggedError(
          'NOT_CONNECTED',
          'La sala no está confirmada como ingresada.',
          'muc.send',
        );
      const self =
        record.state.selfOccupantJid && record.participants.get(record.state.selfOccupantJid);
      if (!self || !['participant', 'moderator'].includes(self.role))
        throw taggedError('UNAUTHORIZED', 'El usuario no tiene voz en la sala.', 'muc.send');
      await adapter
        .requireConnected(input.accountId)
        .send(
          xml(
            'message',
            { type: 'groupchat', to: roomJid, id: input.clientMessageId },
            xml('body', {}, input.body.text),
            xml('origin-id', { xmlns: 'urn:xmpp:sid:0', id: input.clientMessageId }),
          ),
        );
      return {
        accountId: input.accountId,
        roomJid,
        clientMessageId: input.clientMessageId,
        status: 'sent',
      };
    },
    createMucRoom(accountId, room, generation, nickname, requestId) {
      let resolveJoin;
      let rejectJoin;
      let resolveLeave;
      const joinPromise = new Promise((resolve, reject) => {
        resolveJoin = resolve;
        rejectJoin = reject;
      });
      const leavePromise = new Promise((resolve) => {
        resolveLeave = resolve;
      });
      joinPromise.catch(() => undefined);
      return {
        accountId,
        generation,
        room,
        nickname,
        requestId,
        active: true,
        participants: new Map(),
        seenMessageIds: new Set(),
        joinPromise,
        resolveJoin,
        rejectJoin,
        leavePromise,
        resolveLeave,
        state: {
          accountId,
          room,
          status: 'joining',
          participants: [],
          sessionGeneration: generation,
        },
      };
    },
    emitMucState(record, correlationId) {
      adapter.emit({
        type: 'muc.stateChanged',
        correlationId: correlationId || record.requestId,
        payload: { ...record.state, participants: [...record.participants.values()] },
      });
    },
    emitMucParticipant(record, participant, correlationId) {
      adapter.emit({
        type: 'muc.participantChanged',
        correlationId: correlationId || record.requestId,
        payload: {
          accountId: record.accountId,
          room: record.room,
          participant,
          sessionGeneration: record.generation,
        },
      });
    },
    mucPolicyKey(accountId, service, endpoint) {
      return `${accountId.toLowerCase()}|${service.toLowerCase()}|${endpoint?.host?.toLowerCase() || ''}:${endpoint?.port || ''}|${endpoint?.transport || ''}`;
    },
    assertSessionCurrent(accountId, session, generation, domain) {
      if (
        adapter.sessions.get(accountId) !== session ||
        adapter.sessionGenerations.get(accountId) !== generation ||
        adapter.sessionDomains.get(accountId) !== domain ||
        adapter.states.get(accountId)?.status !== 'connected'
      )
        throw taggedError('NOT_CONNECTED', 'La sesión XMPP ya no es vigente.', 'muc.session');
    },
    assertMucRequest(input) {
      if (
        !input ||
        input.version !== 1 ||
        typeof input.requestId !== 'string' ||
        !input.requestId.trim() ||
        typeof input.accountId !== 'string' ||
        !input.accountId.trim()
      )
        throw taggedError('INVALID_INPUT', 'La solicitud MUC no es válida.', 'muc.input');
    },
    validateRoomJid(value) {
      if (
        typeof value !== 'string' ||
        value.length > 512 ||
        value.includes('/') ||
        !/^[^@\s]+@[^@\s]+$/.test(value.trim())
      )
        throw taggedError('INVALID_INPUT', 'El JID de sala no es válido.', 'muc.input');
      return value.trim().toLowerCase();
    },
    validateNickname(value) {
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        value.length > 128 ||
        /[\s/@<>:&"']/.test(value)
      )
        throw taggedError('INVALID_INPUT', 'El nickname no es válido.', 'muc.input');
      return value.trim();
    },
    withTimeout(promise, milliseconds, code, message) {
      let timer;
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(taggedError(code, message, 'muc.timeout')), milliseconds);
        }),
      ]).finally(() => clearTimeout(timer));
    },
    clearMucRooms(accountId) {
      const rooms = adapter.mucRooms.get(accountId);
      if (!rooms) return;
      for (const record of rooms.values()) {
        record.rejectJoin?.(taggedError('NOT_CONNECTED', 'La sesión XMPP terminó.', 'muc.session'));
        record.participants.clear();
      }
      rooms.clear();
      adapter.mucRooms.delete(accountId);
      adapter.mucDiscoveries.delete(accountId);
    },
    failMucRoom(record, error) {
      if (!record || record.state.status === 'failed' || record.state.status === 'idle') return;
      const code = error?.code || 'TRANSPORT_FAILED';
      record.state = {
        ...record.state,
        status: 'failed',
        errorCode: [
          'INVALID_INPUT',
          'UNAUTHORIZED',
          'NOT_CONNECTED',
          'TIMEOUT',
          'TRANSPORT_FAILED',
          'CONFLICT',
          'UNSUPPORTED',
          'INTERNAL',
        ].includes(code)
          ? code
          : 'TRANSPORT_FAILED',
        participants: [],
      };
      record.active = false;
      record.participants.clear();
      adapter.emitMucState(record);
      record.rejectJoin?.(error);
      const rooms = adapter.mucRooms.get(record.accountId);
      if (rooms?.get(record.room.jid.toLowerCase()) === record)
        rooms.delete(record.room.jid.toLowerCase());
    },
    handleMucStanza(accountId, stanza) {
      if (stanza.is('presence')) return adapter.handleMucPresence(accountId, stanza);
      if (stanza.is('message') && stanza.attrs.type === 'groupchat') {
        adapter.handleMucMessage(accountId, stanza);
        return true;
      }
      return false;
    },
    handleMucPresence(accountId, stanza) {
      const from = String(stanza.attrs.from || '');
      const roomJid = adapter.bareJid(from);
      const record = adapter.mucRooms.get(accountId)?.get(roomJid.toLowerCase());
      if (
        !record ||
        !record.active ||
        record.generation !== adapter.sessionGenerations.get(accountId) ||
        !['joining', 'joined', 'leaving'].includes(record.state.status)
      )
        return false;
      const type = stanza.attrs.type;
      const errorCondition = stanza
        .getChild('error')
        ?.getChildren()
        ?.find((child) => child.name !== 'text')?.name;
      if (type === 'error' || errorCondition) {
        const error = taggedError(
          adapter.mucConditionCode(errorCondition),
          'El servidor rechazó la entrada a la sala.',
          'muc.join',
        );
        record.rejectJoin?.(error);
        adapter.failMucRoom(record, error);
        return true;
      }
      const x = stanza.getChild('x', MUC_USER_NS);
      const item = x?.getChild('item');
      const statusCodes = new Set(
        (x?.getChildren('status') || []).map((status) => String(status.attrs.code || '')),
      );
      const participant = {
        occupantJid: from,
        nick: from.split('/').slice(1).join('/') || '',
        role: adapter.mucRole(item?.attrs.role),
        affiliation: adapter.mucAffiliation(item?.attrs.affiliation),
        availability: type === 'unavailable' ? 'unavailable' : 'available',
      };
      if (type === 'unavailable') record.participants.delete(from);
      else record.participants.set(from, participant);
      if (record.state.status !== 'leaving') adapter.emitMucParticipant(record, participant);
      if (type === 'unavailable' && statusCodes.has('110') && record.state.status === 'leaving') {
        record.state = { ...record.state, status: 'idle', participants: [] };
        record.active = false;
        record.resolveLeave?.(record.state);
        adapter.mucRooms.get(accountId)?.delete(roomJid.toLowerCase());
        adapter.emitMucState(record, record.leaveRequestId);
        return true;
      }
      if (record.state.status === 'leaving') return true;
      if (statusCodes.has('100'))
        adapter.emit({
          type: 'muc.notice',
          payload: {
            accountId,
            roomJid,
            code: 'IDENTITY_VISIBLE',
            sessionGeneration: record.generation,
          },
        });
      if (statusCodes.has('170'))
        adapter.emit({
          type: 'muc.notice',
          payload: {
            accountId,
            roomJid,
            code: 'PUBLIC_LOGGING',
            sessionGeneration: record.generation,
          },
        });
      if (statusCodes.has('210'))
        adapter.emit({
          type: 'muc.notice',
          payload: {
            accountId,
            roomJid,
            code: 'SERVER_NICKNAME',
            nickname: participant.nick,
            sessionGeneration: record.generation,
          },
        });
      if (type === 'unavailable' && statusCodes.has('110')) {
        const error = taggedError(
          'TRANSPORT_FAILED',
          'La presencia propia fue retirada antes de confirmar la entrada.',
          'muc.join',
        );
        adapter.failMucRoom(record, error);
        return true;
      }
      if (statusCodes.has('201')) {
        const error = taggedError(
          'CONFLICT',
          'El servidor indicó que la sala fue creada durante la entrada.',
          'muc.join',
        );
        void Promise.resolve(
          adapter
            .requireConnected(accountId)
            .send(xml('presence', { to: from, type: 'unavailable' })),
        ).catch(() => undefined);
        adapter.failMucRoom(record, error);
        return true;
      }
      if (statusCodes.has('110')) {
        record.state = {
          ...record.state,
          status: 'joined',
          selfOccupantJid: from,
          participants: [...record.participants.values()],
        };
        adapter.emitMucState(record);
        record.resolveJoin?.(record.state);
      }
      return true;
    },
    handleMucMessage(accountId, stanza) {
      const from = String(stanza.attrs.from || '');
      const roomJid = adapter.bareJid(from);
      const record = adapter.mucRooms.get(accountId)?.get(roomJid.toLowerCase());
      if (!record || record.generation !== adapter.sessionGenerations.get(accountId)) return;
      const body = stanza.getChildText('body');
      if (typeof body !== 'string') return;
      const explicitId = stanza.attrs.id || stanza.getChild('origin-id')?.attrs?.id || '';
      const identity = explicitId
        ? `${accountId}|${roomJid}|${from}|${explicitId}`
        : `muc_${crypto.randomUUID()}`;
      const id = explicitId
        ? `room_${crypto.createHash('sha256').update(identity).digest('hex')}`
        : identity;
      if (record.seenMessageIds.has(id)) return;
      record.seenMessageIds.add(id);
      if (record.seenMessageIds.size > MUC_MESSAGE_BUFFER_LIMIT * 2)
        record.seenMessageIds.delete(record.seenMessageIds.values().next().value);
      const source =
        stanza.getChild('delay', DELAY_NS) || stanza.getChild('x', LEGACY_DELAY_NS)
          ? 'server-history'
          : 'live';
      const clientMessageId =
        stanza.getChild('origin-id')?.attrs?.id ||
        (from === record.state.selfOccupantJid ? explicitId || undefined : undefined);
      const message = {
        id,
        accountId,
        roomJid,
        occupantJid: from,
        body: { kind: 'text', text: body },
        receivedAt: new Date().toISOString(),
        ...(clientMessageId ? { clientMessageId } : {}),
        source,
        sessionGeneration: record.generation,
      };
      if (source === 'live')
        record.messageBuffer = [...(record.messageBuffer || []), message].slice(
          -MUC_MESSAGE_BUFFER_LIMIT,
        );
      adapter.emit({
        type: 'muc.messageReceived',
        correlationId: clientMessageId || id,
        payload: message,
      });
    },
    mucRole(value) {
      return ['none', 'visitor', 'participant', 'moderator'].includes(value) ? value : 'none';
    },
    mucAffiliation(value) {
      return ['none', 'member', 'admin', 'owner'].includes(value) ? value : 'none';
    },
    mucConditionCode(condition) {
      return ['conflict', 'not-acceptable'].includes(condition)
        ? 'CONFLICT'
        : ['forbidden', 'not-authorized', 'registration-required', 'membership-required'].includes(
              condition,
            )
          ? 'UNAUTHORIZED'
          : [
                'service-unavailable',
                'item-not-found',
                'remote-server-not-found',
                'recipient-unavailable',
              ].includes(condition)
            ? 'NOT_CONNECTED'
            : condition === 'resource-constraint'
              ? 'CONFLICT'
              : 'TRANSPORT_FAILED';
    },
  };
}

module.exports = { createMucService };
