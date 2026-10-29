const crypto = require('node:crypto');
const { xml } = require('@xmpp/client');
const {
  parseOffer,
  IBB_NS,
  SI_NS,
  SI_FILE_NS,
  FEATURE_NEG_NS,
  DATAFORM_NS,
  validateOpen,
  validateData,
} = require('./file-protocol.cjs');

const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';
const MAX_PENDING_BINARY_BYTES = 256 * 1024;

function fileTrace(phase, direction, details = {}) {
  if (process.env.ATOMIC_XMPP_FILE_TRACE !== 'true') return;
  const allowed = new Set([
    'phase',
    'direction',
    'at',
    'iqType',
    'condition',
    'result',
    'errorCode',
    'blockSize',
    'seq',
    'bytes',
    'correlation',
  ]);
  const safe = { phase, direction, at: new Date().toISOString() };
  for (const [key, value] of Object.entries(details)) if (allowed.has(key)) safe[key] = value;
  console.info('[XMPP_FILE_TRACE]', JSON.stringify(safe));
}

function taggedError(code, message, phase, cause) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  if (cause) error.cause = cause;
  return error;
}

function createFileService(adapter) {
  return {
    traceStanza(accountId, stanza) {
      if (
        process.env.ATOMIC_XMPP_FILE_TRACE === 'true' &&
        stanza?.is?.('iq') &&
        stanza.attrs?.type === 'set' &&
        stanza.getChild?.('si', SI_NS)
      ) {
        const correlation = `attempt_${crypto.randomUUID()}`;
        adapter.fileTraceAttempts.set(stanza, correlation);
        fileTrace('FILE_IQ_CANDIDATE_RX', 'RX', { iqType: 'set', correlation });
      }
      if (process.env.ATOMIC_XMPP_DEBUG === 'true')
        console.debug(
          '[XMPP_STANZA]',
          JSON.stringify({
            accountId,
            from: stanza.attrs?.from || '',
            to: stanza.attrs?.to || '',
            type: stanza.name || stanza.attrs?.type || '',
            id: stanza.attrs?.id || '',
            hasBody: Boolean(stanza.getChildText?.('body')),
          }),
        );
    },
    async sendFile(accountId, input) {
      if (!adapter.outgoingTransfers)
        throw taggedError('UNSUPPORTED', 'El envío de archivos no está disponible.', 'file.send');
      const session = adapter.requireConnected(accountId);
      const generation = adapter.sessionGenerations.get(accountId) || 0;
      const recipientJid = await adapter.resolveFileRecipient(
        accountId,
        input.conversationId,
        session,
        generation,
      );
      const conversationId = adapter.bareJid(recipientJid);
      const offer = {
        transferId: `file_${crypto.randomUUID()}`,
        accountId,
        conversationId,
        senderJid: accountId,
        recipientJid,
        name: input.fileName,
        sizeBytes: '0',
        transport: 'ibb',
        offeredAt: new Date().toISOString(),
      };
      return adapter.outgoingTransfers.start({
        filePath: input.filePath,
        siSessionId: `si_${crypto.randomUUID()}`,
        offer,
        ownerSenderId: input.ownerSenderId,
        transport: {
          sendOffer: (record) => adapter.sendOutgoingOffer(accountId, session, generation, record),
          sendOpen: (record, blockSize) =>
            adapter.sendOutgoingOpen(accountId, session, generation, record, blockSize),
          sendData: (record, block, sequence) =>
            adapter.sendOutgoingData(accountId, session, generation, record, block, sequence),
          sendClose: (record) => adapter.sendOutgoingClose(accountId, session, generation, record),
        },
      });
    },
    async resolveFileRecipient(accountId, conversationId, session, generation) {
      const bare = adapter.bareJid(conversationId).toLowerCase();
      const roster = adapter.rosters.get(accountId);
      const contact = [...(roster?.entries() || [])].find(
        ([jid]) => jid.toLowerCase() === bare,
      )?.[1];
      if (!contact || !['to', 'both'].includes(contact.subscription))
        throw taggedError(
          'RECIPIENT_UNAVAILABLE',
          'El destinatario no está autorizado en el roster.',
          'file.recipient',
        );
      const resources = [...(adapter.remoteResources.get(accountId)?.entries() || [])].filter(
        ([jid]) => jid.split('/')[0].toLowerCase() === bare,
      );
      const recipientJid = resources.at(-1)?.[0];
      if (!recipientJid)
        throw taggedError(
          'RECIPIENT_UNAVAILABLE',
          'No hay un recurso disponible para el destinatario.',
          'file.recipient',
        );
      adapter.assertSessionCurrent(
        accountId,
        session,
        generation,
        adapter.sessionDomains.get(accountId) || '',
      );
      const response = await session.iqCaller.request(
        xml(
          'iq',
          { type: 'get', id: `file_disco_${crypto.randomUUID()}`, to: recipientJid },
          xml('query', { xmlns: DISCO_INFO_NS }),
        ),
      );
      adapter.assertSessionCurrent(
        accountId,
        session,
        generation,
        adapter.sessionDomains.get(accountId) || '',
      );
      if (
        !response?.is?.('iq') ||
        response.attrs?.type !== 'result' ||
        response.attrs?.from !== recipientJid
      )
        throw taggedError(
          'RECIPIENT_UNAVAILABLE',
          'La respuesta de capacidades no corresponde al recurso seleccionado.',
          'file.recipient',
        );
      const features = new Set(
        response
          .getChild('query', DISCO_INFO_NS)
          ?.getChildren('feature')
          .map((feature) => feature.attrs.var),
      );
      if (![SI_NS, SI_FILE_NS, IBB_NS].every((feature) => features.has(feature)))
        throw taggedError(
          'UNSUPPORTED_METHOD',
          'El recurso no ofrece SI File Transfer mediante IBB.',
          'file.recipient',
        );
      return recipientJid;
    },
    async requestOutgoingIq(accountId, session, generation, record, child, phase) {
      adapter.assertSessionCurrent(
        accountId,
        session,
        generation,
        adapter.sessionDomains.get(accountId) || '',
      );
      const currentResources = adapter.remoteResources.get(accountId);
      if (!currentResources?.has(record.offer.recipientJid))
        throw taggedError(
          'RECIPIENT_UNAVAILABLE',
          'El recurso del destinatario ya no está disponible.',
          `file.${phase}`,
        );
      const id = `file_${phase}_${crypto.randomUUID()}`;
      const response = await session.iqCaller.request(
        xml('iq', { type: 'set', id, to: record.offer.recipientJid }, child),
      );
      adapter.assertSessionCurrent(
        accountId,
        session,
        generation,
        adapter.sessionDomains.get(accountId) || '',
      );
      if (
        !response?.is?.('iq') ||
        response.attrs?.id !== id ||
        response.attrs?.from !== record.offer.recipientJid
      )
        throw taggedError(
          'TRANSPORT_FAILED',
          `La respuesta IQ ${phase} no está correlacionada.`,
          `file.${phase}`,
        );
      if (response.attrs.type === 'error') {
        const condition = response
          .getChild('error')
          ?.getChildren()
          ?.find((item) => item.name !== 'text')?.name;
        throw taggedError(
          condition === 'not-acceptable' ? 'UNSUPPORTED_METHOD' : 'REMOTE_REJECTED',
          `El receptor rechazó ${phase}.`,
          `file.${phase}`,
        );
      }
      if (response.attrs.type !== 'result')
        throw taggedError(
          'TRANSPORT_FAILED',
          `La respuesta IQ ${phase} no es un resultado.`,
          `file.${phase}`,
        );
      return response;
    },
    async sendOutgoingOffer(accountId, session, generation, record) {
      const si = xml(
        'si',
        { xmlns: SI_NS, id: record.siSessionId, profile: SI_FILE_NS },
        xml('file', { xmlns: SI_FILE_NS, name: record.offer.name, size: record.offer.sizeBytes }),
        xml(
          'feature',
          { xmlns: FEATURE_NEG_NS },
          xml(
            'x',
            { xmlns: DATAFORM_NS, type: 'form' },
            xml(
              'field',
              { var: 'stream-method', type: 'list-single' },
              xml('option', {}, xml('value', {}, IBB_NS)),
            ),
          ),
        ),
      );
      const response = await adapter.requestOutgoingIq(
        accountId,
        session,
        generation,
        record,
        si,
        'si',
      );
      const values =
        response
          .getChild('si', SI_NS)
          ?.getChild('feature', FEATURE_NEG_NS)
          ?.getChild('x', DATAFORM_NS)
          ?.getChildren('field')
          .flatMap((field) => field.getChildren('value').map((value) => value.getText())) || [];
      if (!values.includes(IBB_NS))
        throw taggedError('UNSUPPORTED_METHOD', 'El receptor no seleccionó IBB.', 'file.si');
      return response;
    },
    sendOutgoingOpen(accountId, session, generation, record, blockSize) {
      return adapter.requestOutgoingIq(
        accountId,
        session,
        generation,
        record,
        xml('open', {
          xmlns: IBB_NS,
          sid: record.siSessionId,
          'block-size': String(blockSize),
          stanza: 'iq',
        }),
        'open',
      );
    },
    sendOutgoingData(accountId, session, generation, record, block, sequence) {
      return adapter.requestOutgoingIq(
        accountId,
        session,
        generation,
        record,
        xml(
          'data',
          { xmlns: IBB_NS, sid: record.siSessionId, seq: String(sequence) },
          block.toString('base64'),
        ),
        'data',
      );
    },
    sendOutgoingClose(accountId, session, generation, record) {
      return adapter.requestOutgoingIq(
        accountId,
        session,
        generation,
        record,
        xml('close', { xmlns: IBB_NS, sid: record.siSessionId }),
        'close',
      );
    },
    isFileIq(stanza) {
      if (!stanza?.is?.('iq') || !['get', 'set'].includes(stanza.attrs?.type)) return false;
      return Boolean(
        stanza.getChild?.('si', SI_NS) ||
        stanza.getChild?.('open', IBB_NS) ||
        stanza.getChild?.('data', IBB_NS) ||
        stanza.getChild?.('close', IBB_NS) ||
        stanza.getChild?.('query', DISCO_INFO_NS),
      );
    },
    installFileIqHandlers(accountId, session) {
      if (!session?.iqCallee?.set || !session?.iqCallee?.get) return;
      const handler = async (context) => {
        adapter.fileIqHandled.add(context.stanza);
        const response = await adapter.handleFileIq(accountId, context.stanza);
        if (response) adapter.observeFileIqReply(session, context.stanza, response);
        return response;
      };
      session.iqCallee.get(DISCO_INFO_NS, 'query', handler);
      session.iqCallee.set(SI_NS, 'si', handler);
      session.iqCallee.set(IBB_NS, 'open', handler);
      session.iqCallee.set(IBB_NS, 'data', handler);
      session.iqCallee.set(IBB_NS, 'close', handler);
    },
    observeFileIqReply(session, request, response) {
      if (process.env.ATOMIC_XMPP_FILE_TRACE !== 'true' || !session?.on) return;
      const child =
        request.getChild?.('si', SI_NS) ||
        request.getChild?.('open', IBB_NS) ||
        request.getChild?.('data', IBB_NS) ||
        request.getChild?.('close', IBB_NS) ||
        request.getChild?.('query', DISCO_INFO_NS);
      const phase =
        child?.getName?.() === 'si'
          ? 'SI_RESULT'
          : child?.getName?.() === 'open'
            ? 'IBB_OPEN_RESULT'
            : child?.getName?.() === 'data'
              ? 'IBB_DATA'
              : child?.getName?.() === 'close'
                ? 'IBB_CLOSE'
                : 'DISCO_INFO';
      const correlation = adapter.fileTraceAttempts.get(request);
      let settled = false;
      let timer;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.removeListener?.('send', onSend);
        session.removeListener?.('error', onError);
      };
      const onSend = (sent) => {
        if (!sent?.is?.('iq') || sent.attrs?.id !== request.attrs?.id) return;
        fileTrace(`${phase}_TX_FULFILLED`, 'TX', {
          iqType: sent.attrs.type,
          result: sent.attrs.type === 'result' ? 'sent' : undefined,
          correlation,
        });
        cleanup();
      };
      const onError = () => {
        fileTrace(`${phase}_TX_FAILED`, 'TX', {
          iqType: request.attrs?.type,
          errorCode: 'TRANSPORT_FAILED',
          correlation,
        });
        cleanup();
      };
      session.on('send', onSend);
      session.on('error', onError);
      timer = setTimeout(cleanup, 30000);
      timer.unref?.();
    },
    handleFileIq(accountId, stanza, options = {}) {
      if (!adapter.fileTransfers || !stanza?.is?.('iq')) return undefined;
      const session = adapter.sessions.get(accountId);
      const generation = adapter.sessionGenerations.get(accountId) || 0;
      const si = stanza.getChild?.('si', SI_NS);
      const open = stanza.getChild?.('open', IBB_NS);
      const data = stanza.getChild?.('data', IBB_NS);
      const close = stanza.getChild?.('close', IBB_NS);
      const disco = stanza.getChild?.('query', DISCO_INFO_NS);
      const deliver = async (child) => {
        if (options.send) await options.send(child);
        return child;
      };
      const errorElement = (condition) =>
        xml(
          'error',
          { type: 'cancel' },
          xml(condition, { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }),
        );
      const conditionFor = (cause) =>
        cause?.code === 'RESOURCE_CONSTRAINT' || cause?.message === 'RESOURCE_CONSTRAINT'
          ? 'resource-constraint'
          : cause?.code === 'UNSUPPORTED_METHOD'
            ? 'not-acceptable'
            : cause?.code === 'CONFLICT' || cause?.message === 'NOT_ACCEPTED'
              ? 'not-acceptable'
              : cause?.code === 'UNAUTHORIZED'
                ? 'not-authorized'
                : cause?.message === 'BAD_SENDER'
                  ? 'item-not-found'
                  : cause?.message === 'INVALID_BASE64'
                    ? 'bad-request'
                    : cause?.message === 'BAD_REQUEST'
                      ? 'bad-request'
                      : 'undefined-condition';
      if (stanza.attrs?.type === 'get' && disco) {
        fileTrace('DISCO_INFO', 'RX', { iqType: 'get' });
        const response = xml(
          'query',
          { xmlns: DISCO_INFO_NS },
          xml('feature', { var: SI_NS }),
          xml('feature', { var: SI_FILE_NS }),
          xml('feature', { var: IBB_NS }),
        );
        fileTrace('DISCO_INFO', 'TX', { iqType: 'result', result: 'supported' });
        return response;
      }
      if (stanza.attrs?.type !== 'set' || (!si && !open && !data && !close)) return undefined;
      if (si) {
        const attempt = adapter.fileTraceAttempts.get(stanza) || `attempt_${crypto.randomUUID()}`;
        adapter.fileTraceAttempts.set(stanza, attempt);
        fileTrace('SI_OFFER_RX', 'RX', {
          iqType: stanza.attrs.type,
          result: 'recognized',
          correlation: attempt,
        });
        try {
          const offer = parseOffer(stanza, accountId, generation);
          const publicOffer = {
            transferId: offer.transferId,
            accountId,
            conversationId: offer.conversationId,
            senderJid: offer.senderJid,
            name: offer.name,
            sizeBytes: offer.sizeBytes,
            ...(offer.description ? { description: offer.description } : {}),
            transport: 'ibb',
            offeredAt: new Date().toISOString(),
          };
          let replied = false;
          let resolveResponse;
          let rejectResponse;
          const response = new Promise((resolve, reject) => {
            resolveResponse = resolve;
            rejectResponse = reject;
          });
          const reply = async (child) => {
            if (replied) return;
            replied = true;
            try {
              await deliver(child);
              resolveResponse(child);
            } catch (cause) {
              rejectResponse(cause);
              throw cause;
            }
          };
          const replyError = async (reason) => {
            if (replied) return;
            const condition = reason === 'user_rejected' ? 'forbidden' : 'not-acceptable';
            fileTrace('SI_ERROR', 'TX', { iqType: 'error', condition, correlation: attempt });
            await reply(errorElement(condition));
          };
          const record = adapter.fileTransfers.add({
            offer: publicOffer,
            iqOfferId: offer.iqId,
            siSessionId: offer.siSid,
            ownerSenderId: adapter.fileOwners.get(accountId),
            iq: stanza,
            session,
            onRejected: replyError,
            onAccepted: async () => {
              if (replied) throw new Error('SI_ALREADY_REPLIED');
              fileTrace('SI_RESULT_TX_ATTEMPT', 'TX', { iqType: 'result', correlation: attempt });
              try {
                await reply(
                  xml(
                    'si',
                    { xmlns: SI_NS },
                    xml(
                      'feature',
                      { xmlns: FEATURE_NEG_NS },
                      xml(
                        'x',
                        { xmlns: DATAFORM_NS, type: 'submit' },
                        xml('field', { var: 'stream-method' }, xml('value', {}, IBB_NS)),
                      ),
                    ),
                  ),
                );
                if (options.send)
                  fileTrace('SI_RESULT_TX_FULFILLED', 'TX', {
                    iqType: 'result',
                    correlation: attempt,
                  });
              } catch (cause) {
                if (options.send)
                  fileTrace('SI_RESULT_TX_FAILED', 'TX', {
                    iqType: 'result',
                    errorCode: 'TRANSPORT_FAILED',
                    correlation: attempt,
                  });
                throw cause;
              }
            },
          });
          adapter.filePending.set(`${accountId}|${generation}|${offer.senderJid}|${offer.siSid}`, {
            record,
            session,
            generation,
            attempt,
            protocolQueue: Promise.resolve(),
            openState: 'idle',
            pendingBinaryBytes: 0,
          });
          fileTrace('SI_OFFER_REGISTERED', 'RX', { result: 'offered', correlation: attempt });
          return response;
        } catch (cause) {
          const condition =
            cause?.code === 'UNSUPPORTED_METHOD'
              ? 'not-acceptable'
              : cause?.code === 'RESOURCE_CONSTRAINT'
                ? 'resource-constraint'
                : cause?.code === 'BAD_REQUEST'
                  ? 'bad-request'
                  : 'undefined-condition';
          fileTrace('SI_PARSE_REJECTED', 'RX', {
            iqType: 'set',
            condition,
            correlation: adapter.fileTraceAttempts.get(stanza),
          });
          return errorElement(condition);
        }
      }
      const sid = open?.attrs?.sid || data?.attrs?.sid || close?.attrs?.sid || '';
      const pending = adapter.filePending.get(
        `${accountId}|${generation}|${stanza.attrs.from}|${sid}`,
      );
      if (open)
        fileTrace('IBB_OPEN_CANDIDATE_RX', 'RX', {
          iqType: 'set',
          correlation: pending?.attempt || `open_${crypto.randomUUID()}`,
        });
      if (!pending) {
        if (open)
          fileTrace('IBB_OPEN_UNMATCHED', 'RX', { iqType: 'set', condition: 'item-not-found' });
        return errorElement('item-not-found');
      }
      if (stanza.attrs.from !== pending.record.offer.senderJid)
        return errorElement('item-not-found');
      const enqueue = (operation) => {
        const task = pending.protocolQueue.then(operation);
        pending.protocolQueue = task.catch(() => undefined);
        return task;
      };
      if (open) {
        if (pending.openState !== 'idle') return errorElement('not-acceptable');
        pending.openState = 'queued';
        try {
          if (pending.record.state !== 'accepted') throw new Error('NOT_ACCEPTED');
          pending.blockSize = validateOpen(
            open,
            pending.record.siSessionId,
            pending.record.offer.senderJid,
          );
          pending.sid = open.attrs.sid;
          pending.seq = 0;
        } catch (cause) {
          pending.openState = 'failed';
          void adapter.fileTransfers
            .fail(
              pending.record.offer.transferId,
              cause?.message === 'NOT_ACCEPTED' ? 'cancelled_by_sender' : 'invalid_protocol',
            )
            .catch(() => undefined);
          fileTrace('IBB_OPEN_RESULT_TX_FAILED', 'TX', {
            iqType: 'error',
            condition: conditionFor(cause),
            correlation: pending.attempt,
          });
          return errorElement(conditionFor(cause));
        }
        return enqueue(async () => {
          const record = pending.record;
          pending.openState = 'processing';
          if (record.state !== 'accepted') throw new Error('NOT_ACCEPTED');
          await adapter.fileTransfers.open(record.offer.transferId);
          pending.openState = 'ready';
          fileTrace('IBB_OPEN_MATCHED', 'RX', {
            iqType: 'set',
            blockSize: pending.blockSize,
            result: 'accepted',
            correlation: pending.attempt,
          });
          return {};
        })
          .then(deliver)
          .catch(async (cause) => {
            pending.openState = 'failed';
            await adapter.fileTransfers
              .fail(
                pending.record.offer.transferId,
                cause?.message === 'NOT_ACCEPTED' ? 'cancelled_by_sender' : 'invalid_protocol',
              )
              .catch(() => undefined);
            fileTrace('IBB_OPEN_RESULT_TX_FAILED', 'TX', {
              iqType: 'error',
              condition: conditionFor(cause),
              correlation: pending.attempt,
            });
            return deliver(errorElement(conditionFor(cause)));
          });
      }
      if (data) {
        if (['idle', 'failed'].includes(pending.openState) || !pending.blockSize)
          return errorElement('not-acceptable');
        const reservation = pending.blockSize;
        if (pending.pendingBinaryBytes + reservation > MAX_PENDING_BINARY_BYTES)
          return errorElement('resource-constraint');
        pending.pendingBinaryBytes += reservation;
        return enqueue(async () => {
          try {
            const expectedSeq = pending.seq;
            const bytes = validateData(
              data,
              pending.sid,
              pending.record.offer.senderJid,
              pending.blockSize,
              expectedSeq,
            );
            fileTrace('IBB_DATA', 'RX', {
              iqType: 'set',
              seq: expectedSeq,
              bytes: bytes.length,
              correlation: pending.attempt,
            });
            await adapter.fileTransfers.append(pending.record.offer.transferId, bytes);
            pending.seq = (expectedSeq + 1) % 65536;
            return {};
          } finally {
            pending.pendingBinaryBytes -= reservation;
          }
        })
          .then(deliver)
          .catch(async (cause) => {
            if (cause?.code !== 'RESOURCE_CONSTRAINT')
              await adapter.fileTransfers
                .fail(pending.record.offer.transferId, 'storage_failed')
                .catch(() => undefined);
            fileTrace('IBB_DATA', 'TX', {
              iqType: 'error',
              condition: conditionFor(cause),
              correlation: pending.attempt,
            });
            return deliver(errorElement(conditionFor(cause)));
          });
      }
      return enqueue(async () => {
        if (!pending.sid || pending.record.state !== 'transferring')
          throw new Error('NOT_ACCEPTED');
        fileTrace('IBB_CLOSE', 'RX', { iqType: 'set', correlation: pending.attempt });
        await adapter.fileTransfers.complete(pending.record.offer.transferId);
        fileTrace('IBB_CLOSE', 'TX', {
          iqType: 'result',
          result: 'completed',
          correlation: pending.attempt,
        });
        return {};
      })
        .then(deliver)
        .catch(async (cause) => {
          await adapter.fileTransfers
            .fail(
              pending.record.offer.transferId,
              cause?.message === 'NOT_ACCEPTED' ? 'invalid_protocol' : 'storage_failed',
            )
            .catch(() => undefined);
          fileTrace('IBB_CLOSE', 'TX', {
            iqType: 'error',
            condition: conditionFor(cause),
            correlation: pending.attempt,
          });
          return deliver(errorElement(conditionFor(cause)));
        });
    },
    handleFileStanza(accountId, stanza) {
      if (!adapter.fileTransfers || !stanza?.is?.('iq')) return false;
      const session = adapter.sessions.get(accountId);
      const sendChild = (child) => {
        if (!child || !session?.send) return undefined;
        const type = child.is?.('error') ? 'error' : 'result';
        return session.send(xml('iq', { type, id: stanza.attrs.id, to: stanza.attrs.from }, child));
      };
      const response = adapter.handleFileIq(accountId, stanza, { send: sendChild });
      if (response === undefined) return false;
      if (!response?.then) void Promise.resolve(sendChild(response)).catch(() => undefined);
      else {
        const child =
          stanza.getChild?.('open', IBB_NS) ||
          stanza.getChild?.('data', IBB_NS) ||
          stanza.getChild?.('close', IBB_NS);
        const sid = child?.attrs?.sid;
        const generation = adapter.sessionGenerations.get(accountId) || 0;
        const pending = sid
          ? adapter.filePending.get(`${accountId}|${generation}|${stanza.attrs.from}|${sid}`)
          : undefined;
        if (pending) pending.protocolQueue = response.catch(() => undefined);
        else void response.catch(() => undefined);
      }
      return true;
    },
  };
}

module.exports = { createFileService };
