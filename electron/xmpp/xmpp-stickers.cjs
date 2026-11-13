const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fsp = require('node:fs/promises');
const https = require('node:https');
const xmppClient = require('@xmpp/client');
const stickerProtocol = require('../stickers/sticker-protocol.cjs');

const UPLOAD_NS = 'urn:xmpp:http:upload:0';
const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';
const DISCO_ITEMS_NS = 'http://jabber.org/protocol/disco#items';
const DATAFORM_NS = 'jabber:x:data';
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren: (name?: string, namespace?: string) => XmlNode[], getChildText: (name: string, namespace?: string) => string | undefined, getText: () => string | undefined, is: (name: string) => boolean}} XmlNode
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs?: number) => Promise<XmlNode>}, send: (stanza: {attrs?: XmlAttributes}) => Promise<unknown>}} StickerSession
 * @typedef {{accountId: string, conversationId: string, stickerId: string, clientMessageId: string}} StickerSendInput
 * @typedef {{name: string, altText: string, mimeType: string, sizeBytes: number | string, width: number | string, height: number | string, hashValue: string, assetId?: string, bytes?: Uint8Array, path?: string}} StickerSource
 * @typedef {{accountId?: string, serviceJid: string, maxFileSize?: number}} UploadService
 * @typedef {{putUrl: string, getUrl: string, headers: Record<string, string | string[]>, headerEntries: Array<[string, string]>, lookup: (hostname: string, options: unknown, callback: (error: Error | null, address: string, family?: number) => void) => void}} UploadSlot
 * @typedef {{lookup?: (hostname: string, options: {all: true}) => Promise<Array<{address: string, family?: number}>>, put?: (url: string, body: Uint8Array, headers: Record<string, string | string[]>, options: {timeoutMs?: number, lookup?: unknown, headerEntries?: Array<[string, string]>}) => Promise<number>, readFile?: (filePath: string) => Promise<Buffer>, storageProvider?: StorageProvider, storageConfiguration?: {alternativeAvailable?: boolean}}} StickerOptions
 * @typedef {{providerId: string, ownsReference?: (value: unknown) => boolean, getCapabilities: (input: {accountId: string}) => Promise<{providerId: string, storageOrigins: string[], maxFileSize?: number}>, uploadSticker: (input: unknown) => Promise<{assetId: string, remoteUrl: string}>, resolveSticker: (input: unknown) => Promise<{availability: string, remoteUrl: string, providerId: string, storageOrigin: string}>}} StorageProvider
 * @typedef {{sessionDomains: Map<string, string>, sessionGenerations: Map<string, number>, requireConnected: (accountId: string) => StickerSession, assertSessionCurrent: (accountId: string, session: StickerSession, generation: number, domain: string) => void, withTimeout: <T>(promise: Promise<T>, milliseconds: number, code: string, message: string) => Promise<T>, bareJid: (jid: string) => string, emit: (event: unknown) => void}} StickerAdapter
 */

const xml =
  /** @type {(name: string, ...children: Array<XmlAttributes | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

const {
  FILE_NS,
  FALLBACK_NS,
  HASHES_NS,
  MAX_DIMENSION,
  MAX_STICKER_BYTES,
  SFS_NS,
  STORAGE_NS,
  STICKERS_NS,
  URL_DATA_NS,
  assertPublicHost,
  buildStickerMessage,
  dimensionsFor,
  hashFromBase64,
  hashToBase64,
  isPrivateAddress,
  parseStickerMessage,
  previewStickerId,
  refIdFor,
  safeFileName,
  safeText,
  validateHttpsUrl,
  validateStickerMetadata,
} = stickerProtocol;

/** @param {string} code @param {string} message @param {string} phase @param {unknown} [originalCause] */
function stickerError(code, message, phase, originalCause) {
  const error = new Error(message);
  return Object.assign(error, {
    code,
    phase,
    ...(originalCause ? { cause: originalCause } : {}),
  });
}

/** @param {unknown} error @returns {string | undefined} */
function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** @param {unknown} error @returns {string | undefined} */
function errorMessage(error) {
  return error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : undefined;
}

/** @param {string} url @param {Uint8Array} body @param {Record<string, string | string[]>} headers @param {{headerEntries?: Array<[string, string]>, timeoutMs?: number, lookup?: unknown}} [options] */
function putHttps(url, body, headers, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const requestHeaders = /** @type {import('node:http').OutgoingHttpHeaders} */ ({});
    for (const [name, value] of options.headerEntries || Object.entries(headers)) {
      if (!Object.hasOwn(requestHeaders, name)) requestHeaders[name] = value;
      else {
        const headerValue = /** @type {string | string[]} */ (value);
        requestHeaders[name] = Array.isArray(requestHeaders[name])
          ? [...requestHeaders[name], ...[headerValue].flat()]
          : [String(requestHeaders[name]), ...[headerValue].flat()];
      }
    }
    requestHeaders['Content-Type'] = headers['Content-Type'];
    requestHeaders['Content-Length'] = String(body.length);
    const request = https.request(
      target,
      /** @type {import('node:https').RequestOptions} */ ({
        method: 'PUT',
        headers: requestHeaders,
        timeout: options.timeoutMs || 15000,
        rejectUnauthorized: true,
        ...(options.lookup
          ? { lookup: /** @type {import('node:net').LookupFunction} */ (options.lookup) }
          : {}),
      }),
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode || 0));
      },
    );
    request.once('error', reject);
    request.once('timeout', () =>
      request.destroy(stickerError('TIMEOUT', 'la carga del sticker expiró', 'sticker.upload')),
    );
    request.end(body);
  });
}

/** @param {StickerAdapter} adapter @param {StickerOptions} [options] */
function createXmppStickerService(adapter, options = {}) {
  const discoveries = new Map();
  const attempts = new Map();
  const lookup = options.lookup || dns.lookup;
  const put = options.put || putHttps;
  const readFile = options.readFile || ((filePath) => fsp.readFile(filePath));
  const storageProvider = options.storageProvider;
  const storageConfiguration = options.storageConfiguration || { alternativeAvailable: false };

  /** @param {string} accountId @param {StickerSession} session @param {number} generation */
  function current(accountId, session, generation) {
    adapter.assertSessionCurrent(
      accountId,
      session,
      generation,
      adapter.sessionDomains.get(accountId) || '',
    );
  }

  /** @param {string} accountId @param {XmlNode} stanza @param {'incoming' | 'outgoing'} [direction='incoming'] */
  function parseWithProvider(accountId, stanza, direction = 'incoming') {
    const parsed = parseStickerMessage(accountId, stanza, direction);
    if (!parsed || !storageProvider) return parsed;
    if (!storageProvider.ownsReference?.(parsed)) {
      const { storageProviderId: _providerId, storageOrigin: _origin, ...unlinked } = parsed;
      return unlinked;
    }
    return {
      ...parsed,
      storageProviderId: storageProvider.providerId,
      storageOrigin: parsed.storageOrigin,
    };
  }

  /** @param {StickerSession} session @param {string} to @param {XmlNode} child */
  async function requestDisco(session, to, child) {
    return adapter.withTimeout(
      session.iqCaller.request(
        xml('iq', { type: 'get', to, id: `sticker_disco_${crypto.randomUUID()}` }, child),
      ),
      10000,
      'TIMEOUT',
      'discovery timeout',
    );
  }

  /** @param {XmlNode} response @param {string} target @returns {UploadService | undefined} */
  function parseUploadInfo(response, target) {
    if (!response?.is?.('iq') || response.attrs?.['type'] !== 'result') return undefined;
    const query = response.getChild('query', DISCO_INFO_NS);
    const supported = Boolean(
      query?.getChildren('feature').some((feature) => feature.attrs?.['var'] === UPLOAD_NS),
    );
    if (!query || !supported) return undefined;
    const field = query
      .getChild('x', DATAFORM_NS)
      ?.getChildren('field')
      .find((item) => item.attrs?.['var'] === 'max-file-size');
    const rawLimit = field?.getChildText('value');
    const maxFileSize = rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : undefined;
    return {
      serviceJid: target,
      maxFileSize: Number.isSafeInteger(maxFileSize) ? maxFileSize : undefined,
    };
  }

  /** @param {string} accountId @param {StickerSession} session @param {number} generation @returns {Promise<UploadService & {discoveredAt: string}>} */
  async function discover(accountId, session, generation) {
    const cached = discoveries.get(accountId);
    if (
      cached &&
      cached.session === session &&
      cached.generation === generation &&
      cached.expiresAt > Date.now()
    )
      return cached.value;
    const domain = adapter.sessionDomains.get(accountId) || '';
    if (!domain)
      throw stickerError('UNSUPPORTED', 'el dominio XMPP no está disponible', 'sticker.discovery');
    current(accountId, session, generation);
    const itemsResponse = await requestDisco(
      session,
      domain,
      xml('query', { xmlns: DISCO_ITEMS_NS }),
    );
    current(accountId, session, generation);
    const itemTargets =
      itemsResponse
        ?.getChild('query', DISCO_ITEMS_NS)
        ?.getChildren('item')
        .map((item) => item.attrs?.['jid'])
        .filter((target) => typeof target === 'string') || [];
    const targets = [domain, ...itemTargets.filter((target) => target !== domain)];
    for (const target of targets) {
      const response = await requestDisco(session, target, xml('query', { xmlns: DISCO_INFO_NS }));
      const value = parseUploadInfo(response, target);
      if (value) {
        const result = { ...value, accountId, generation, discoveredAt: new Date().toISOString() };
        discoveries.set(accountId, {
          session,
          generation,
          expiresAt: Date.now() + DISCOVERY_TTL_MS,
          value: result,
        });
        return result;
      }
    }
    throw stickerError(
      'UNSUPPORTED',
      'el servidor no ofrece HTTP Upload compatible',
      'sticker.discovery',
    );
  }

  /** @param {string} accountId @param {StickerSession} session @param {number} generation @param {UploadService} service @param {StickerSource} sticker @returns {Promise<UploadSlot>} */
  async function requestSlot(accountId, session, generation, service, sticker) {
    current(accountId, session, generation);
    const response = await adapter.withTimeout(
      session.iqCaller.request(
        xml(
          'iq',
          { type: 'get', to: service.serviceJid, id: `sticker_slot_${crypto.randomUUID()}` },
          xml('request', {
            xmlns: UPLOAD_NS,
            filename: safeFileName(sticker.name),
            size: String(sticker.sizeBytes),
            'content-type': sticker.mimeType,
          }),
        ),
      ),
      10000,
      'TIMEOUT',
      'slot timeout',
    );
    current(accountId, session, generation);
    const slot = response?.getChild('slot', UPLOAD_NS);
    const puts = slot?.getChildren('put', UPLOAD_NS) || [];
    const gets = slot?.getChildren('get', UPLOAD_NS) || [];
    const putElement = puts.length === 1 ? puts[0] : undefined;
    const getElement = gets.length === 1 ? gets[0] : undefined;
    const putUrl = putElement?.attrs?.['url'];
    const getUrl = getElement?.attrs?.['url'];
    if (
      response?.attrs?.['type'] !== 'result' ||
      puts.length !== 1 ||
      gets.length !== 1 ||
      !putUrl ||
      !getUrl
    )
      throw stickerError('UNSUPPORTED', 'el slot HTTP Upload no es válido', 'sticker.slot');
    const headers = /** @type {Record<string, string | string[]>} */ ({});
    const headerEntries = /** @type {Array<[string, string]>} */ ([]);
    for (const header of putElement.getChildren('header')) {
      const name = String(header.attrs?.['name'] || '').trim();
      const content = String(header.getText() || '').replace(/[\r\n]/g, '');
      const lowerName = name.toLowerCase();
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        !['authorization', 'cookie', 'expires'].includes(lowerName) ||
        !content
      )
        continue;
      headerEntries.push([name, content]);
      if (!Object.hasOwn(headers, name)) headers[name] = content;
      else
        headers[name] = Array.isArray(headers[name])
          ? [...headers[name], content]
          : [headers[name], content];
    }
    const normalizedPut = validateHttpsUrl(putUrl);
    const normalizedGet = validateHttpsUrl(getUrl);
    const putAddresses = await assertPublicHost(normalizedPut, lookup);
    await assertPublicHost(normalizedGet, lookup);
    const selected = putAddresses[0];
    if (!selected)
      throw stickerError('UNSUPPORTED', 'no hay una dirección de upload válida', 'sticker.slot');
    return {
      putUrl: normalizedPut,
      getUrl: normalizedGet,
      headers,
      headerEntries,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    };
  }

  return {
    /** @param {{accountId: string}} input */
    async discover(input) {
      if (storageProvider) {
        const value = await storageProvider.getCapabilities({ accountId: input.accountId });
        return {
          transportMode: 'PERSISTENT_HTTPS',
          persistentHttpsAvailable: true,
          providerId: value.providerId,
          storageOrigins: value.storageOrigins,
          maxFileSize: value.maxFileSize === undefined ? undefined : Number(value.maxFileSize),
        };
      }
      const session = adapter.requireConnected(input.accountId);
      const generation = adapter.sessionGenerations.get(input.accountId) || 0;
      const value = await discover(input.accountId, session, generation);
      return {
        ...value,
        transportMode: 'HTTP_UPLOAD_XEP0363',
        persistentHttpsAvailable: storageConfiguration.alternativeAvailable === true,
      };
    },
    /** @param {StickerSendInput} input @param {(accountId: string, stickerId: string) => Promise<StickerSource>} resolveSource @param {(state: Record<string, unknown>) => void | Promise<void>} [onState] */
    async send(
      input,
      resolveSource,
      onState = /** @type {(state: Record<string, unknown>) => void | Promise<void>} */ (
        () => undefined
      ),
    ) {
      const attemptKey = `${input.accountId}|${adapter.bareJid(input.conversationId)}|${input.clientMessageId}`;
      const existing = attempts.get(attemptKey);
      if (existing) return existing;
      let state;
      let sendConfirmed = false;
      const operation = (async () => {
        try {
          const session = adapter.requireConnected(input.accountId);
          const generation = adapter.sessionGenerations.get(input.accountId) || 0;
          const source = await resolveSource(input.accountId, input.stickerId);
          const metadata = validateStickerMetadata({ ...source, hashValue: source.hashValue });
          if (
            Number(source.sizeBytes) !== metadata.sizeBytes ||
            Number(source.width) !== metadata.width ||
            Number(source.height) !== metadata.height
          )
            throw stickerError(
              'MEDIA_DECODE_FAILED',
              'el asset local no coincide con su metadata',
              'sticker.source',
            );
          const now = new Date().toISOString();
          const refId = refIdFor(
            input.accountId,
            input.conversationId,
            input.clientMessageId,
            'outgoing',
            input.accountId,
          );
          state = {
            refId,
            previewStickerId: previewStickerId(refId),
            accountId: input.accountId,
            conversationId: adapter.bareJid(input.conversationId),
            clientMessageId: input.clientMessageId,
            originId: input.clientMessageId,
            direction: 'outgoing',
            senderJid: input.accountId,
            sourceStickerId: input.stickerId,
            name: source.name,
            altText: source.altText,
            mimeType: source.mimeType,
            sizeBytes: String(metadata.sizeBytes),
            width: metadata.width,
            height: metadata.height,
            hashAlgorithm: 'sha-256',
            hashValue: source.hashValue,
            localAssetId: source.assetId,
            transportStatus: 'uploading',
            availability: 'available',
            createdAt: now,
            updatedAt: now,
          };
          await onState(state);
          current(input.accountId, session, generation);
          let slot;
          if (!storageProvider) {
            const service = await discover(input.accountId, session, generation);
            if (service.maxFileSize !== undefined && metadata.sizeBytes > service.maxFileSize)
              throw stickerError(
                'MEDIA_SIZE_EXCEEDED',
                'el servicio de upload no admite este tamaño',
                'sticker.slot',
              );
            slot = await requestSlot(input.accountId, session, generation, service, source);
          }
          if (!source.bytes && !source.path)
            throw stickerError(
              'MEDIA_DECODE_FAILED',
              'el asset no tiene una fuente local',
              'sticker.source',
            );
          const sourcePath = source.path;
          const bytes = source.bytes ? Buffer.from(source.bytes) : await readFile(sourcePath || '');
          current(input.accountId, session, generation);
          if (bytes.length !== metadata.sizeBytes)
            throw stickerError(
              'MEDIA_DECODE_FAILED',
              'el asset cambió durante la carga',
              'sticker.upload',
            );
          const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
          if (actualHash !== String(source.hashValue).toLowerCase())
            throw stickerError(
              'MEDIA_DECODE_FAILED',
              'la integridad del asset no coincide',
              'sticker.upload',
            );
          const storageMetadata = {
            mimeType: source.mimeType,
            sizeBytes: String(metadata.sizeBytes),
            width: metadata.width,
            height: metadata.height,
            hashAlgorithm: 'sha-256',
            hashValue: String(source.hashValue).toLowerCase(),
          };
          /** @type {string | undefined} */
          let remoteUrl;
          /** @type {{availability: string, remoteUrl: string, providerId: string, storageOrigin: string} | undefined} */
          let resolvedAsset;
          if (storageProvider) {
            const capabilities = await storageProvider.getCapabilities({
              accountId: input.accountId,
            });
            if (
              capabilities.maxFileSize !== undefined &&
              metadata.sizeBytes > Number(capabilities.maxFileSize)
            )
              throw stickerError(
                'MEDIA_SIZE_EXCEEDED',
                'el proveedor no admite este tamaño',
                'sticker.storage',
              );
            const uploaded = await storageProvider.uploadSticker({
              accountId: input.accountId,
              idempotencyKey: input.clientMessageId,
              metadata: storageMetadata,
              bytes,
            });
            resolvedAsset = await storageProvider.resolveSticker({
              accountId: input.accountId,
              assetId: uploaded.assetId,
              remoteUrl: uploaded.remoteUrl,
              expected: storageMetadata,
            });
            if (resolvedAsset.availability !== 'available')
              throw stickerError(
                'MEDIA_PREVIEW_UNAVAILABLE',
                'el asset no está disponible para descarga',
                'sticker.storage',
              );
            remoteUrl = resolvedAsset.remoteUrl;
          } else {
            const uploadSlot = /** @type {UploadSlot} */ (slot);
            const status = await put(
              uploadSlot.putUrl,
              bytes,
              { ...uploadSlot.headers, 'Content-Type': source.mimeType },
              {
                timeoutMs: 15000,
                lookup: uploadSlot.lookup,
                headerEntries: uploadSlot.headerEntries,
              },
            );
            if (status !== 201)
              throw stickerError(
                'TRANSPORT_FAILED',
                'HTTP Upload no confirmó el recurso',
                'sticker.upload',
              );
            remoteUrl = uploadSlot.getUrl;
          }
          if (!remoteUrl)
            throw stickerError('TRANSPORT_FAILED', 'no se obtuvo una URL remota', 'sticker.upload');
          if (storageProvider && !resolvedAsset)
            throw stickerError(
              'MEDIA_PREVIEW_UNAVAILABLE',
              'el proveedor no resolvió el asset',
              'sticker.storage',
            );
          current(input.accountId, session, generation);
          state = {
            ...state,
            transportStatus: 'sending',
            updatedAt: new Date().toISOString(),
            remoteUrl,
            ...(storageProvider
              ? {
                  storageProviderId: resolvedAsset?.providerId,
                  storageOrigin: resolvedAsset?.storageOrigin,
                }
              : {}),
          };
          await onState(state);
          current(input.accountId, session, generation);
          const stanza = buildStickerMessage({
            to: input.conversationId,
            clientMessageId: input.clientMessageId,
            sticker: source,
            sourceUrl: remoteUrl,
            fallback: source.altText,
            ...(storageProvider
              ? {
                  storageProviderId: resolvedAsset?.providerId,
                  storageOrigin: resolvedAsset?.storageOrigin,
                }
              : {}),
          });
          try {
            await session.send(stanza);
            sendConfirmed = true;
          } catch (cause) {
            throw stickerError(
              'SEND_RESULT_UNKNOWN',
              'el resultado del envío XMPP es incierto',
              'sticker.send',
              cause,
            );
          }
          current(input.accountId, session, generation);
          const sentAt = new Date().toISOString();
          state = {
            ...state,
            stanzaId: clientMessageIdOrUndefined(stanza),
            remoteUrl,
            fallbackText: safeText(source.altText, 1024),
            transportStatus: 'sent',
            updatedAt: sentAt,
          };
          await onState(state);
          current(input.accountId, session, generation);
          return state;
        } catch (error) {
          if (sendConfirmed && errorCode(error) === 'NOT_CONNECTED') {
            error = stickerError(
              'SEND_RESULT_UNKNOWN',
              'el envío se completó antes del cambio de sesión',
              'sticker.session',
              error,
            );
          }
          if (sendConfirmed && error && typeof error === 'object')
            Object.assign(error, { sendConfirmed: true });
          if (state && !sendConfirmed) {
            try {
              await onState({
                ...state,
                transportStatus: 'failed',
                errorCode: errorCode(error) || 'TRANSPORT_FAILED',
                updatedAt: new Date().toISOString(),
              });
            } catch (stateError) {
              if (error && typeof error === 'object') Object.assign(error, { stateError });
            }
          }
          throw error;
        }
      })();
      attempts.set(attemptKey, operation);
      try {
        return await operation;
      } finally {
        attempts.delete(attemptKey);
      }
    },
    /** @param {string} accountId @param {XmlNode} stanza @param {'incoming' | 'outgoing'} [direction='incoming'] */
    parseMessage(accountId, stanza, direction = 'incoming') {
      return parseWithProvider(accountId, stanza, direction);
    },
    /** @param {string} accountId @param {XmlNode} stanza */
    handleMessage(accountId, stanza) {
      try {
        const parsed = parseWithProvider(accountId, stanza, 'incoming');
        if (!parsed) return false;
        adapter.emit({ type: 'sticker.messageReceived', payload: parsed });
      } catch (error) {
        if (
          stanza?.getChild?.('sticker', STICKERS_NS) &&
          process.env['ATOMIC_XMPP_DEBUG'] === 'true'
        )
          console.warn(
            '[XMPP_STICKER] Ignoring invalid sticker stanza:',
            errorCode(error) || errorMessage(error),
          );
      }
      return true;
    },
    /** @param {string} accountId */
    clear(accountId) {
      discoveries.delete(accountId);
      for (const key of attempts.keys()) if (key.startsWith(`${accountId}|`)) attempts.delete(key);
    },
  };
}

/** @param {{attrs?: XmlAttributes}} stanza @returns {string | undefined} */
function clientMessageIdOrUndefined(stanza) {
  return stanza?.attrs?.['id'];
}

module.exports = {
  DATAFORM_NS,
  DISCO_INFO_NS,
  DISCO_ITEMS_NS,
  FALLBACK_NS,
  FILE_NS,
  HASHES_NS,
  MAX_STICKER_BYTES,
  MAX_DIMENSION,
  SFS_NS,
  STORAGE_NS,
  STICKERS_NS,
  UPLOAD_NS,
  URL_DATA_NS,
  buildStickerMessage,
  createXmppStickerService,
  hashFromBase64,
  isPrivateAddress,
  parseStickerMessage,
  previewStickerId,
  refIdFor,
  validateHttpsUrl,
};
