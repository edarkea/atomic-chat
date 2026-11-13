const crypto = require('node:crypto');
const path = require('node:path');
const xmppClient = require('@xmpp/client');
const {
  parseOffer,
  IBB_NS,
  SI_NS,
  SI_FILE_NS,
  FEATURE_NEG_NS,
  DATAFORM_NS,
  validateOpen,
  validateData,
} = require('../files/file-protocol.cjs');
const { createFileTraceService } = require('./xmpp-file-trace.cjs');

const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';
const MAX_PENDING_BINARY_BYTES = 256 * 1024;
const FILE_CANCEL_NS = 'urn:atomic-chat:file-transfer:1';

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{name?: string, attrs?: XmlAttributes, children?: Array<XmlNode | string>, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren: (name?: string, namespace?: string) => XmlNode[], getChildText?: (name: string, namespace?: string) => string | undefined, getText?: () => string | undefined, is: (name: string) => boolean, parent?: XmlNode}} XmlNode
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs?: number) => Promise<XmlNode>, handlers?: Map<string, {resolve: (value: unknown) => void}>}, iqCallee?: {get: (namespace: string, name: string, handler: (context: {stanza: XmlNode}) => Promise<unknown>) => void, set: (namespace: string, name: string, handler: (context: {stanza: XmlNode}) => Promise<unknown>) => void}, send: (stanza: {attrs?: XmlAttributes}) => Promise<unknown>, on: (event: string, listener: (value?: XmlNode) => void) => void}} FileSession
 * @typedef {{transferId: string, accountId: string, conversationId: string, senderJid: string, recipientJid: string, name: string, sizeBytes: string, siSessionId?: string, state?: string, bytes?: bigint, description?: string}} FileOffer
 * @typedef {{offer: FileOffer, siSessionId: string, abortController?: AbortController, terminalRequested?: boolean, ibbOpened?: boolean, timeoutSeconds?: number, cancellationNoticeSent?: boolean, state: string, bytes: bigint}} FileRecord
 * @typedef {{accountId: string, generation: number, senderJid: string, iqId: string, siSid: string, response: Promise<XmlNode>, active: boolean, reject?: (reason?: unknown) => Promise<void>}} SiReply
 * @typedef {{record: FileRecord, session: FileSession, generation: number, attempt: string, protocolQueue: Promise<unknown>, openState: string, pendingBinaryBytes: number, blockSize?: number, sid?: string, seq?: number}} PendingFile
 * @typedef {{conversationId: string, fileName: string, filePath: string, ownerSenderId?: number}} FileSendInput
 * @typedef {{signal?: AbortSignal}} CloseOptions
 * @typedef {{onEvent: (listener: (event: {type: string, payload: {state: string, offer: {transferId: string}, endReason?: string}}) => void) => unknown, start: (input: unknown) => Promise<unknown>, cancelBySender: (transferId: string) => Promise<unknown>, fail: (transferId: string, reason: string) => Promise<unknown>, open: (transferId: string) => Promise<unknown>, append: (transferId: string, bytes: Uint8Array) => Promise<unknown>, complete: (transferId: string) => Promise<unknown>, cancelAccount: (accountId: string) => Promise<unknown>, add: (input: unknown) => FileRecord}} FileTransfers
 * @typedef {{start: (input: unknown) => Promise<unknown>}} OutgoingTransfers
 * @typedef {{packaged?: boolean, fileTransfers?: FileTransfers, outgoingTransfers?: OutgoingTransfers, sessions: Map<string, FileSession>, states: Map<string, {status: string}>, sessionGenerations: Map<string, number>, sessionDomains: Map<string, string>, rosters: Map<string, Map<string, {subscription: string}>>, remoteResources: Map<string, Map<string, unknown>>, fileOwners: Map<string, number | undefined>, fileIqHandled: WeakSet<object>, fileTraceAttempts: WeakMap<object, string>, filePending: Map<string, PendingFile>, requireConnected: (accountId: string) => FileSession, resolveFileRecipient: (accountId: string, conversationId: string, session: FileSession, generation: number) => Promise<string>, bareJid: (jid: string) => string, assertSessionCurrent: (accountId: string, session: FileSession, generation: number, domain: string) => void, sendOutgoingOffer: (accountId: string, session: FileSession, generation: number, record: FileRecord) => Promise<unknown>, sendOutgoingCancellationNotice: (accountId: string, session: FileSession, generation: number, record: FileRecord, reason: string) => Promise<unknown>, sendOutgoingOpen: (accountId: string, session: FileSession, generation: number, record: FileRecord, blockSize: number) => Promise<unknown>, sendOutgoingData: (accountId: string, session: FileSession, generation: number, record: FileRecord, block: Buffer, sequence: number) => Promise<unknown>, sendOutgoingClose: (accountId: string, session: FileSession, generation: number, record: FileRecord, options?: CloseOptions) => Promise<unknown>, requestOutgoingIq: (accountId: string, session: FileSession, generation: number, record: FileRecord, child: XmlNode, phase: string, signal?: AbortSignal) => Promise<XmlNode>, handleFileIq: (accountId: string, stanza: XmlNode, options?: {send?: (child: XmlNode) => Promise<unknown>}) => XmlNode | Promise<XmlNode> | undefined, observeFileIqReply: (session: FileSession, request: XmlNode, response: XmlNode) => unknown, emit: (event: unknown) => void}} FileAdapter
 */

const xml =
  /** @type {(name: string, ...children: Array<XmlAttributes | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

/** @param {string} code @param {string} message @param {string} phase @param {unknown} [cause] */
function taggedError(code, message, phase, cause) {
  const error = new Error(message);
  return Object.assign(error, {
    code,
    phase,
    ...(cause ? { cause } : {}),
  });
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function property(value, key) {
  return value && typeof value === 'object' && key in value
    ? /** @type {Record<string, unknown>} */ (value)[key]
    : undefined;
}

/** @param {unknown} value @param {string} key @returns {string | undefined} */
function stringProperty(value, key) {
  const candidate = property(value, key);
  return typeof candidate === 'string' ? candidate : undefined;
}

/** @param {unknown} cause @param {string} phase */
function outgoingIqError(cause, phase) {
  const condition = property(cause, 'condition');
  const element = /** @type {XmlNode | undefined} */ (property(cause, 'element'));
  const unsupportedSi =
    phase === 'si' &&
    (element?.getChild('no-valid-streams', SI_NS) || element?.getChild('bad-profile', SI_NS));
  const normalizedCondition = typeof condition === 'string' ? condition : '';
  const code =
    property(cause, 'name') === 'TimeoutError' || normalizedCondition === 'remote-server-timeout'
      ? 'TIMEOUT'
      : normalizedCondition === 'forbidden'
        ? 'REMOTE_REJECTED'
        : unsupportedSi ||
            ['not-acceptable', 'feature-not-implemented', 'service-unavailable'].includes(
              normalizedCondition,
            )
          ? 'UNSUPPORTED_METHOD'
          : ['recipient-unavailable', 'remote-server-not-found'].includes(normalizedCondition)
            ? 'RECIPIENT_UNAVAILABLE'
            : 'TRANSPORT_FAILED';
  return taggedError(code, `Falló la solicitud IQ ${phase}.`, `file.${phase}`, cause);
}

/** @param {XmlNode} element @returns {XmlNode} */
function copyReply(element) {
  return xml(
    element.name || 'unknown',
    { ...element.attrs },
    ...(element.children || []).map((child) =>
      typeof child === 'string' ? child : copyReply(child),
    ),
  );
}

/** @param {FileAdapter} adapter */
function createFileService(adapter) {
  const traceService = createFileTraceService(adapter);
  // Keep active negotiations and the most recent terminal decisions. Never evict an active SI.
  /** @type {Map<string, SiReply>} */
  const siReplies = new Map();
  const maxSiReplies = 256;
  adapter.fileTransfers?.onEvent((event) => {
    if (
      event.type !== 'file.stateChanged' ||
      !['completed', 'failed', 'cancelled'].includes(event.payload.state)
    )
      return;
    const entry = siReplies.get(event.payload.offer.transferId);
    if (!entry) return;
    entry.active = false;
    // A failure before acceptance must also settle the waiting IQ handler.
    void entry.reject?.(event.payload.endReason).catch(() => undefined);
  });
  return {
    /** @param {string} accountId @param {XmlNode} stanza */
    traceStanza(accountId, stanza) {
      return traceService.traceStanza(accountId, stanza);
    },
    /** @param {string} accountId @param {FileSendInput} input */
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
      const extension = path.extname(input.fileName).toLowerCase();
      const mimeType =
        extension === '.png'
          ? 'image/png'
          : extension === '.jpg' || extension === '.jpeg'
            ? 'image/jpeg'
            : undefined;
      const offer = {
        transferId: `file_${crypto.randomUUID()}`,
        accountId,
        conversationId,
        senderJid: accountId,
        recipientJid,
        name: input.fileName,
        ...(mimeType ? { mimeType } : {}),
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
          sendOffer: /** @param {FileRecord} record */ (record) =>
            adapter.sendOutgoingOffer(accountId, session, generation, record),
          sendCancellationNotice: /** @param {FileRecord} record @param {string} reason */ (
            record,
            reason,
          ) =>
            adapter.sendOutgoingCancellationNotice(accountId, session, generation, record, reason),
          sendOpen: /** @param {FileRecord} record @param {number} blockSize */ (
            record,
            blockSize,
          ) => adapter.sendOutgoingOpen(accountId, session, generation, record, blockSize),
          sendData:
            /** @param {FileRecord} record @param {Buffer} block @param {number} sequence */ (
              record,
              block,
              sequence,
            ) => adapter.sendOutgoingData(accountId, session, generation, record, block, sequence),
          sendClose: /** @param {FileRecord} record @param {CloseOptions} options */ (
            record,
            options,
          ) => adapter.sendOutgoingClose(accountId, session, generation, record, options),
        },
      });
    },
    /** @param {string} accountId @param {string} conversationId @param {FileSession} session @param {number} generation */
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
        response.attrs?.['type'] !== 'result' ||
        response.attrs?.['from'] !== recipientJid
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
          .map((feature) => feature.attrs?.['var']),
      );
      if (![SI_NS, SI_FILE_NS, IBB_NS].every((feature) => features.has(feature)))
        throw taggedError(
          'UNSUPPORTED_METHOD',
          'El recurso no ofrece SI File Transfer mediante IBB.',
          'file.recipient',
        );
      return recipientJid;
    },
    /** @param {string} accountId @param {FileSession} session @param {number} generation @param {FileRecord} record @param {XmlNode} child @param {string} phase @param {AbortSignal | undefined} signalOverride */
    async requestOutgoingIq(accountId, session, generation, record, child, phase, signalOverride) {
      const signal = signalOverride || record.abortController?.signal;
      const isAbortClose = phase === 'close' && record.ibbOpened && signalOverride;
      const assertActive = () => {
        if (signal?.aborted || (record.terminalRequested && !isAbortClose))
          throw taggedError('CANCELLED', 'La transferencia ya terminó.', `file.${phase}`);
        if (phase === 'close' && !record.ibbOpened)
          throw taggedError('CONFLICT', 'IBB no tiene una apertura confirmada.', 'file.close');
      };
      assertActive();
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
      const retire = () => {
        // @xmpp/iq 0.14 has no abort API. Retire only this request's Deferred.
        // Resolve (rather than reject) even if entity.send is still pending, to avoid
        // an unhandled rejection before the library installs its timeout observer.
        const handlers = session.iqCaller.handlers;
        if (!handlers) return;
        const pending = handlers?.get(id);
        if (pending) {
          handlers.delete(id);
          pending.resolve(undefined);
        }
      };
      let response;
      signal?.addEventListener('abort', retire, { once: true });
      try {
        response = await session.iqCaller.request(
          xml('iq', { type: 'set', id, to: record.offer.recipientJid }, child),
          record.timeoutSeconds ? record.timeoutSeconds * 1000 : undefined,
        );
      } catch (cause) {
        assertActive();
        adapter.assertSessionCurrent(
          accountId,
          session,
          generation,
          adapter.sessionDomains.get(accountId) || '',
        );
        const causeElement = /** @type {XmlNode | undefined} */ (property(cause, 'element'));
        const stanza = causeElement?.parent;
        if (
          stanza &&
          (stanza.attrs?.['id'] !== id || stanza.attrs?.['from'] !== record.offer.recipientJid)
        )
          throw taggedError(
            'TRANSPORT_FAILED',
            'El error IQ no está correlacionado.',
            `file.${phase}`,
          );
        throw outgoingIqError(cause, phase);
      } finally {
        signal?.removeEventListener('abort', retire);
      }
      assertActive();
      adapter.assertSessionCurrent(
        accountId,
        session,
        generation,
        adapter.sessionDomains.get(accountId) || '',
      );
      if (
        !response?.is?.('iq') ||
        response.attrs?.['id'] !== id ||
        response.attrs?.['from'] !== record.offer.recipientJid
      )
        throw taggedError(
          'TRANSPORT_FAILED',
          `La respuesta IQ ${phase} no está correlacionada.`,
          `file.${phase}`,
        );
      if (response.attrs?.['type'] === 'error') {
        const condition = response
          .getChild('error')
          ?.getChildren()
          ?.find((item) => item.name !== 'text')?.name;
        throw outgoingIqError({ condition, element: response.getChild('error') }, phase);
      }
      if (response.attrs?.['type'] !== 'result')
        throw taggedError(
          'TRANSPORT_FAILED',
          `La respuesta IQ ${phase} no es un resultado.`,
          `file.${phase}`,
        );
      return response;
    },
    /** @param {string} accountId @param {FileSession} session @param {number} generation @param {FileRecord} record */
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
      const form = response
        .getChild('si', SI_NS)
        ?.getChild('feature', FEATURE_NEG_NS)
        ?.getChild('x', DATAFORM_NS);
      const fields =
        form?.getChildren('field').filter((field) => field.attrs?.['var'] === 'stream-method') ||
        [];
      const values = fields.flatMap((field) =>
        field.getChildren('value').map((value) => value.getText?.()),
      );
      if (
        form?.attrs?.['type'] !== 'submit' ||
        fields.length !== 1 ||
        values.length !== 1 ||
        values[0] !== IBB_NS
      )
        throw taggedError('UNSUPPORTED_METHOD', 'El receptor no seleccionó IBB.', 'file.si');
      return response;
    },
    /** @param {string} accountId @param {XmlNode} stanza */
    handleFileCancellationMessage(accountId, stanza) {
      const cancellation = stanza?.getChild?.('cancel', FILE_CANCEL_NS);
      const senderJid = stanza?.attrs?.['from'];
      const sid = cancellation?.attrs?.['sid'];
      if (!adapter.fileTransfers || !senderJid || !sid) return false;
      const match = [...siReplies.entries()].find(
        ([, entry]) =>
          entry.active &&
          entry.accountId === accountId &&
          entry.senderJid === senderJid &&
          entry.siSid === sid,
      );
      if (!match) return false;
      void adapter.fileTransfers.cancelBySender(match[0]).catch(() => undefined);
      return true;
    },
    /** @param {string} accountId @param {FileSession} session @param {number} generation @param {FileRecord} record @param {string} reason */
    async sendOutgoingCancellationNotice(accountId, session, generation, record, reason) {
      if (record.cancellationNoticeSent) return;
      if (adapter.sessions.get(accountId) !== session) return;
      if (adapter.states.get(accountId)?.status !== 'connected') return;
      adapter.assertSessionCurrent(
        accountId,
        session,
        generation,
        adapter.sessionDomains.get(accountId) || '',
      );
      // One attempt per transfer, including a failed send; this is not a remote ACK.
      record.cancellationNoticeSent = true;
      const id = `file_cancel_${crypto.randomUUID()}`;
      const body =
        reason === 'timed_out'
          ? `El emisor finalizó localmente el envío de «${record.offer.name}» porque venció el tiempo de espera. Si la solicitud sigue visible, puedes descartarla; este aviso no confirma su cierre.`
          : `El emisor canceló localmente el envío de «${record.offer.name}». Si la solicitud sigue visible, puedes descartarla; este aviso no confirma su cierre.`;
      await session.send(
        xml(
          'message',
          { type: 'chat', to: record.offer.recipientJid, id },
          xml('body', {}, body),
          xml('cancel', { xmlns: FILE_CANCEL_NS, sid: record.siSessionId }),
          xml('origin-id', { xmlns: 'urn:xmpp:sid:0', id }),
        ),
      );
    },
    /** @param {string} accountId @param {FileSession} session @param {number} generation @param {FileRecord} record @param {number} blockSize */
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
    /** @param {string} accountId @param {FileSession} session @param {number} generation @param {FileRecord} record @param {Buffer} block @param {number} sequence */
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
    /** @param {string} accountId @param {FileSession} session @param {number} generation @param {FileRecord} record @param {CloseOptions} [options] */
    sendOutgoingClose(accountId, session, generation, record, options = {}) {
      return adapter.requestOutgoingIq(
        accountId,
        session,
        generation,
        record,
        xml('close', { xmlns: IBB_NS, sid: record.siSessionId }),
        'close',
        options.signal,
      );
    },
    /** @param {XmlNode} stanza */
    isFileIq(stanza) {
      if (!stanza?.is?.('iq') || !['get', 'set'].includes(stanza.attrs?.['type'] || ''))
        return false;
      return Boolean(
        stanza.getChild?.('si', SI_NS) ||
        stanza.getChild?.('open', IBB_NS) ||
        stanza.getChild?.('data', IBB_NS) ||
        stanza.getChild?.('close', IBB_NS) ||
        stanza.getChild?.('query', DISCO_INFO_NS),
      );
    },
    /** @param {string} accountId @param {FileSession} session */
    installFileIqHandlers(accountId, session) {
      if (!session?.iqCallee?.set || !session?.iqCallee?.get) return;
      /** @param {{stanza: XmlNode}} context */
      const handler = async (context) => {
        adapter.fileIqHandled.add(context.stanza);
        if (adapter.sessions.get(accountId) !== session) return undefined;
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
    /** @param {FileSession} session @param {XmlNode} request @param {XmlNode} response */
    observeFileIqReply(session, request, response) {
      return traceService.observeFileIqReply(session, request, response);
    },
    /** @param {string} accountId @param {XmlNode} stanza @param {{send?: (child: XmlNode) => Promise<unknown>}} [options] */
    handleFileIq(accountId, stanza, options = {}) {
      const transfers = adapter.fileTransfers;
      if (!transfers || !stanza?.is?.('iq')) return undefined;
      const session = adapter.sessions.get(accountId);
      if (!session) return undefined;
      const generation = adapter.sessionGenerations.get(accountId) || 0;
      const si = stanza.getChild?.('si', SI_NS);
      const open = stanza.getChild?.('open', IBB_NS);
      const data = stanza.getChild?.('data', IBB_NS);
      const close = stanza.getChild?.('close', IBB_NS);
      const disco = stanza.getChild?.('query', DISCO_INFO_NS);
      /** @param {XmlNode} child */
      /** @param {unknown} child @returns {Promise<unknown>} */
      const deliver = async (child) => {
        if (options.send) await options.send(/** @type {XmlNode} */ (child));
        return child;
      };
      /** @param {string} condition */
      const errorElement = (condition) =>
        xml(
          'error',
          { type: 'cancel' },
          xml(condition, { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }),
        );
      /** @param {unknown} cause */
      const conditionFor = (cause) =>
        stringProperty(cause, 'code') === 'RESOURCE_CONSTRAINT' ||
        stringProperty(cause, 'message') === 'RESOURCE_CONSTRAINT'
          ? 'resource-constraint'
          : stringProperty(cause, 'code') === 'UNSUPPORTED_METHOD'
            ? 'not-acceptable'
            : stringProperty(cause, 'code') === 'CONFLICT' ||
                stringProperty(cause, 'message') === 'NOT_ACCEPTED'
              ? 'not-acceptable'
              : stringProperty(cause, 'code') === 'UNAUTHORIZED'
                ? 'not-authorized'
                : stringProperty(cause, 'message') === 'BAD_SENDER'
                  ? 'item-not-found'
                  : stringProperty(cause, 'message') === 'INVALID_BASE64'
                    ? 'bad-request'
                    : stringProperty(cause, 'message') === 'BAD_REQUEST'
                      ? 'bad-request'
                      : 'undefined-condition';
      if (stanza.attrs?.['type'] === 'get' && disco) {
        traceService.trace('DISCO_INFO', 'RX', { iqType: 'get' });
        const response = xml(
          'query',
          { xmlns: DISCO_INFO_NS },
          xml('feature', { var: SI_NS }),
          xml('feature', { var: SI_FILE_NS }),
          xml('feature', { var: IBB_NS }),
        );
        traceService.trace('DISCO_INFO', 'TX', { iqType: 'result', result: 'supported' });
        return response;
      }
      if (stanza.attrs?.['type'] !== 'set' || (!si && !open && !data && !close)) return undefined;
      if (si) {
        const attempt = adapter.fileTraceAttempts.get(stanza) || `attempt_${crypto.randomUUID()}`;
        adapter.fileTraceAttempts.set(stanza, attempt);
        traceService.trace('SI_OFFER_RX', 'RX', {
          iqType: stanza.attrs?.['type'],
          result: 'recognized',
          correlation: attempt,
        });
        try {
          const duplicate = [...siReplies.values()].find(
            (entry) =>
              entry.accountId === accountId &&
              entry.generation === generation &&
              entry.senderJid === stanza.attrs?.['from'] &&
              (entry.iqId === stanza.attrs?.['id'] || entry.siSid === si.attrs?.['id']),
          );
          if (duplicate) return duplicate.response.then((child) => deliver(copyReply(child)));
          const offer = parseOffer(stanza, accountId, generation);
          if (siReplies.size >= maxSiReplies) {
            const oldest = [...siReplies].find(([, entry]) => !entry.active);
            if (oldest) siReplies.delete(oldest[0]);
            else
              throw taggedError(
                'RESOURCE_CONSTRAINT',
                'SI correlation capacity exceeded',
                'file.si',
              );
          }
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
          /** @type {(value: XmlNode) => void} */
          let resolveResponse = () => undefined;
          /** @type {(reason?: unknown) => void} */
          let rejectResponse = () => undefined;
          const response = /** @type {Promise<XmlNode>} */ (
            new Promise((resolve, reject) => {
              resolveResponse = resolve;
              rejectResponse = reject;
            })
          );
          /** @param {XmlNode} child */
          const reply = async (child) => {
            if (replied) return;
            replied = true;
            delete entry.reject;
            try {
              await deliver(child);
              resolveResponse(child);
            } catch (cause) {
              rejectResponse(cause);
              throw cause;
            }
          };
          /** @param {unknown} reason */
          const replyError = async (reason) => {
            if (replied) return;
            const condition = reason === 'user_rejected' ? 'forbidden' : 'not-acceptable';
            traceService.trace('SI_ERROR', 'TX', {
              iqType: 'error',
              condition,
              correlation: attempt,
            });
            await reply(errorElement(condition));
          };
          /** @type {SiReply} */
          let entry = {
            accountId,
            generation,
            senderJid: offer.senderJid,
            iqId: offer.iqId,
            siSid: offer.siSid,
            response,
            active: true,
            reject: replyError,
          };
          siReplies.set(offer.transferId, entry);
          // Failed admission is cached too, so a replay cannot become a new offer.
          response.catch(() => undefined);
          let record;
          try {
            record = transfers.add({
              offer: publicOffer,
              iqOfferId: offer.iqId,
              siSessionId: offer.siSid,
              ownerSenderId: adapter.fileOwners.get(accountId),
              iq: stanza,
              session,
              onRejected: replyError,
              onAccepted: async () => {
                if (replied) throw new Error('SI_ALREADY_REPLIED');
                traceService.trace('SI_RESULT_TX_ATTEMPT', 'TX', {
                  iqType: 'result',
                  correlation: attempt,
                });
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
                    traceService.trace('SI_RESULT_TX_FULFILLED', 'TX', {
                      iqType: 'result',
                      correlation: attempt,
                    });
                } catch (cause) {
                  if (options.send)
                    traceService.trace('SI_RESULT_TX_FAILED', 'TX', {
                      iqType: 'result',
                      errorCode: 'TRANSPORT_FAILED',
                      correlation: attempt,
                    });
                  throw cause;
                }
              },
            });
          } catch (cause) {
            entry.active = false;
            delete entry.reject;
            replied = true;
            resolveResponse(errorElement(conditionFor(cause)));
            return response.then(deliver);
          }
          adapter.filePending.set(`${accountId}|${generation}|${offer.senderJid}|${offer.siSid}`, {
            record,
            session,
            generation,
            attempt,
            protocolQueue: Promise.resolve(),
            openState: 'idle',
            pendingBinaryBytes: 0,
          });
          traceService.trace('SI_OFFER_REGISTERED', 'RX', {
            result: 'offered',
            correlation: attempt,
          });
          return response;
        } catch (cause) {
          const condition =
            stringProperty(cause, 'code') === 'UNSUPPORTED_METHOD'
              ? 'not-acceptable'
              : stringProperty(cause, 'code') === 'RESOURCE_CONSTRAINT'
                ? 'resource-constraint'
                : stringProperty(cause, 'code') === 'BAD_REQUEST'
                  ? 'bad-request'
                  : 'undefined-condition';
          traceService.trace('SI_PARSE_REJECTED', 'RX', {
            iqType: 'set',
            condition,
            correlation: adapter.fileTraceAttempts.get(stanza),
          });
          return errorElement(condition);
        }
      }
      const sid = open?.attrs?.['sid'] || data?.attrs?.['sid'] || close?.attrs?.['sid'] || '';
      const pending = adapter.filePending.get(
        `${accountId}|${generation}|${stanza.attrs?.['from']}|${sid}`,
      );
      if (open)
        traceService.trace('IBB_OPEN_CANDIDATE_RX', 'RX', {
          iqType: 'set',
          correlation: pending?.attempt || `open_${crypto.randomUUID()}`,
        });
      if (!pending) {
        if (open)
          traceService.trace('IBB_OPEN_UNMATCHED', 'RX', {
            iqType: 'set',
            condition: 'item-not-found',
          });
        return errorElement('item-not-found');
      }
      if (stanza.attrs?.['from'] !== pending.record.offer.senderJid)
        return errorElement('item-not-found');
      /** @param {() => Promise<unknown>} operation */
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
          pending.sid = open.attrs?.['sid'];
          pending.seq = 0;
        } catch (cause) {
          pending.openState = 'failed';
          void transfers
            .fail(
              pending.record.offer.transferId,
              stringProperty(cause, 'message') === 'NOT_ACCEPTED'
                ? 'cancelled_by_sender'
                : 'invalid_protocol',
            )
            .catch(() => undefined);
          traceService.trace('IBB_OPEN_RESULT_TX_FAILED', 'TX', {
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
          await transfers.open(record.offer.transferId);
          pending.openState = 'ready';
          traceService.trace('IBB_OPEN_MATCHED', 'RX', {
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
            await transfers
              .fail(
                pending.record.offer.transferId,
                stringProperty(cause, 'message') === 'NOT_ACCEPTED'
                  ? 'cancelled_by_sender'
                  : 'invalid_protocol',
              )
              .catch(() => undefined);
            traceService.trace('IBB_OPEN_RESULT_TX_FAILED', 'TX', {
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
            const expectedSeq = pending.seq ?? 0;
            const sid = pending.sid;
            if (!sid) throw new Error('NOT_ACCEPTED');
            const blockSize = pending.blockSize || reservation;
            const bytes = validateData(
              data,
              sid,
              pending.record.offer.senderJid,
              blockSize,
              expectedSeq,
            );
            traceService.trace('IBB_DATA', 'RX', {
              iqType: 'set',
              seq: expectedSeq,
              bytes: bytes.length,
              correlation: pending.attempt,
            });
            await transfers.append(pending.record.offer.transferId, bytes);
            pending.seq = (expectedSeq + 1) % 65536;
            return {};
          } finally {
            pending.pendingBinaryBytes -= reservation;
          }
        })
          .then(deliver)
          .catch(async (cause) => {
            if (stringProperty(cause, 'code') !== 'RESOURCE_CONSTRAINT')
              await transfers
                .fail(pending.record.offer.transferId, 'storage_failed')
                .catch(() => undefined);
            traceService.trace('IBB_DATA', 'TX', {
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
        traceService.trace('IBB_CLOSE', 'RX', { iqType: 'set', correlation: pending.attempt });
        if (pending.record.bytes < BigInt(pending.record.offer.sizeBytes)) {
          await transfers.cancelBySender(pending.record.offer.transferId);
          traceService.trace('IBB_CLOSE', 'TX', {
            iqType: 'result',
            result: 'cancelled',
            correlation: pending.attempt,
          });
          return {};
        }
        await transfers.complete(pending.record.offer.transferId);
        traceService.trace('IBB_CLOSE', 'TX', {
          iqType: 'result',
          result: 'completed',
          correlation: pending.attempt,
        });
        return {};
      })
        .then(deliver)
        .catch(async (cause) => {
          await transfers
            .fail(
              pending.record.offer.transferId,
              stringProperty(cause, 'message') === 'NOT_ACCEPTED'
                ? 'invalid_protocol'
                : 'storage_failed',
            )
            .catch(() => undefined);
          traceService.trace('IBB_CLOSE', 'TX', {
            iqType: 'error',
            condition: conditionFor(cause),
            correlation: pending.attempt,
          });
          return deliver(errorElement(conditionFor(cause)));
        });
    },
    /** @param {string} accountId @param {XmlNode} stanza */
    handleFileStanza(accountId, stanza) {
      if (!adapter.fileTransfers || !stanza?.is?.('iq')) return false;
      const session = adapter.sessions.get(accountId);
      /** @param {XmlNode} child */
      const sendChild = (child) => {
        if (!child || !session?.send) return Promise.resolve(undefined);
        const type = child.is?.('error') ? 'error' : 'result';
        return session.send(
          xml('iq', { type, id: stanza.attrs?.['id'], to: stanza.attrs?.['from'] }, child),
        );
      };
      const response = adapter.handleFileIq(accountId, stanza, { send: sendChild });
      if (response === undefined) return false;
      if (!(response instanceof Promise))
        void Promise.resolve(sendChild(response)).catch(() => undefined);
      else {
        const child =
          stanza.getChild?.('open', IBB_NS) ||
          stanza.getChild?.('data', IBB_NS) ||
          stanza.getChild?.('close', IBB_NS);
        const sid = child?.attrs?.['sid'];
        const generation = adapter.sessionGenerations.get(accountId) || 0;
        const pending = sid
          ? adapter.filePending.get(`${accountId}|${generation}|${stanza.attrs?.['from']}|${sid}`)
          : undefined;
        if (pending) pending.protocolQueue = response.catch(() => undefined);
        else void response.catch(() => undefined);
      }
      return true;
    },
  };
}

module.exports = { createFileService };
