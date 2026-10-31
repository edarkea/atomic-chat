const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const fsp = require('node:fs/promises');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const { xml } = require('@xmpp/client');

const STICKERS_NS = 'urn:xmpp:stickers:0';
const SFS_NS = 'urn:xmpp:sfs:0';
const FILE_NS = 'urn:xmpp:file:metadata:0';
const HASHES_NS = 'urn:xmpp:hashes:2';
const URL_DATA_NS = 'http://jabber.org/protocol/url-data';
const FALLBACK_NS = 'urn:xmpp:fallback:0';
const UPLOAD_NS = 'urn:xmpp:http:upload:0';
const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';
const DISCO_ITEMS_NS = 'http://jabber.org/protocol/disco#items';
const DATAFORM_NS = 'jabber:x:data';
const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1024;
const DISCOVERY_TTL_MS = 5 * 60 * 1000;

function stickerError(code, message, phase, originalCause) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  if (originalCause) error.cause = originalCause;
  return error;
}

function hashToBase64(hashValue) {
  if (!/^[a-f0-9]{64}$/i.test(hashValue)) throw stickerError('INVALID_INPUT', 'hash inválido', 'sticker.hash');
  return Buffer.from(hashValue, 'hex').toString('base64');
}

function hashFromBase64(value) {
  const decoded = Buffer.from(String(value || ''), 'base64');
  if (decoded.length !== 32) throw stickerError('INVALID_INPUT', 'hash sha-256 inválido', 'sticker.parse');
  return decoded.toString('hex');
}

function safeText(value, max = 512) {
  const text = String(value || '').trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : undefined;
}

function safeFileName(value) {
  const name = path.basename(String(value || 'sticker.png')).replace(/[\u0000-\u001f\u007f/\\]/g, '_');
  return name.slice(0, 255) || 'sticker.png';
}

function messageIdentity(accountId, conversationId, clientMessageId) {
  return crypto.createHash('sha256').update(`${accountId}|${conversationId}|${clientMessageId}`).digest('hex').slice(0, 32);
}

function refIdFor(accountId, conversationId, clientMessageId, direction = 'outgoing', senderJid = accountId) {
  return `sticker_message_${messageIdentity(accountId, conversationId, `${direction}|${senderJid}|${clientMessageId}`)}`;
}

function previewStickerId(refId) {
  return `message:${refId}`;
}

function dimensionsFor(sticker) {
  const width = Number(sticker.width);
  const height = Number(sticker.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw stickerError('MEDIA_DIMENSIONS_INVALID', 'dimensiones no permitidas', 'sticker.validate');
  return { width, height };
}

function validateStickerMetadata(sticker) {
  if (!sticker || !['image/png', 'image/jpeg'].includes(sticker.mimeType))
    throw stickerError('MEDIA_TYPE_UNSUPPORTED', 'solo se permiten PNG/JPEG estáticos', 'sticker.validate');
  const sizeBytes = Number(sticker.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_STICKER_BYTES)
    throw stickerError('MEDIA_SIZE_EXCEEDED', 'el sticker supera el límite permitido', 'sticker.validate');
  const dimensions = dimensionsFor(sticker);
  if (!/^[a-f0-9]{64}$/i.test(String(sticker.hashValue || '')))
    throw stickerError('MEDIA_DECODE_FAILED', 'el hash del sticker no es válido', 'sticker.validate');
  return { sizeBytes, ...dimensions };
}

function buildStickerMessage({ to, clientMessageId, sticker, sourceUrl, fallback, packId }) {
  if (!safeText(to, 512) || !safeText(clientMessageId, 512)) throw stickerError('INVALID_INPUT', 'destinatario o correlación inválidos', 'sticker.serialize');
  const metadata = validateStickerMetadata(sticker);
  const target = validateHttpsUrl(sourceUrl);
  const fileChildren = [
    xml('media-type', {}, sticker.mimeType),
    xml('name', {}, safeFileName(sticker.name)),
    xml('size', {}, String(metadata.sizeBytes)),
    xml('width', {}, String(metadata.width)),
    xml('height', {}, String(metadata.height)),
    xml('hash', { xmlns: HASHES_NS, algo: 'sha-256' }, hashToBase64(sticker.hashValue)),
  ];
  const description = safeText(sticker.altText, 1024);
  if (description) fileChildren.push(xml('desc', {}, description));
  return xml(
    'message',
    { type: 'chat', to: to.trim(), id: clientMessageId.trim() },
    xml('sticker', { xmlns: STICKERS_NS, ...(packId ? { pack: safeText(packId, 512) } : {}) }),
    xml(
      'file-sharing',
      { xmlns: SFS_NS, disposition: 'inline', id: `sticker-${clientMessageId}` },
      xml('file', { xmlns: FILE_NS }, ...fileChildren),
      xml('sources', {}, xml('url-data', { xmlns: URL_DATA_NS, target })),
    ),
    xml('fallback', { xmlns: FALLBACK_NS, for: SFS_NS }, xml('body')),
    xml('body', {}, safeText(fallback, 1024) || description || 'Sticker'),
    xml('origin-id', { xmlns: 'urn:xmpp:sid:0', id: clientMessageId.trim() }),
  );
}

function parseDimensions(file) {
  const width = Number(file.getChildText('width'));
  const height = Number(file.getChildText('height'));
  if (Number.isInteger(width) && Number.isInteger(height)) return { width, height };
  const dimensions = /^([0-9]+)x([0-9]+)$/.exec(file.getChildText('dimensions') || '');
  if (!dimensions) throw stickerError('MEDIA_DIMENSIONS_INVALID', 'faltan dimensiones válidas', 'sticker.parse');
  return { width: Number(dimensions[1]), height: Number(dimensions[2]) };
}

function parseStickerMessage(accountId, stanza, direction = 'incoming') {
  const stickerElement = stanza?.getChild?.('sticker', STICKERS_NS);
  const sharing = stanza?.getChild?.('file-sharing', SFS_NS);
  if (!stickerElement || !sharing) return null;
  const file = sharing.getChild('file', FILE_NS);
  const mimeType = file?.getChildText('media-type');
  const sizeBytes = file?.getChildText('size');
  const hash = file?.getChild('hash', HASHES_NS);
  const source = sharing.getChild('sources')?.getChild('url-data', URL_DATA_NS)?.attrs?.target;
  if (!file || !mimeType || !sizeBytes || !hash || hash.attrs?.algo !== 'sha-256' || !source)
    throw stickerError('INVALID_INPUT', 'metadata de sticker incompleta', 'sticker.parse');
  const dimensions = parseDimensions(file);
  const clientMessageId = stanza.attrs?.id || stanza.getChild('origin-id', 'urn:xmpp:sid:0')?.attrs?.id;
  const conversationId = String(direction === 'outgoing' ? stanza.attrs?.to : stanza.attrs?.from || '').split('/')[0];
  const senderJid = String(direction === 'outgoing' ? accountId : stanza.attrs?.from || '').split('/')[0];
  if (!clientMessageId || !conversationId || !senderJid) throw stickerError('INVALID_INPUT', 'sticker sin identidad XMPP', 'sticker.parse');
  const metadata = validateStickerMetadata({ mimeType, sizeBytes, ...dimensions, hashValue: hashFromBase64(hash.getText()), });
  const remoteUrl = validateHttpsUrl(source);
  const refId = refIdFor(accountId, conversationId, clientMessageId, direction, senderJid);
  return {
    refId,
    previewStickerId: previewStickerId(refId),
    accountId,
    conversationId,
    clientMessageId,
    stanzaId: stanza.attrs?.id,
    originId: stanza.getChild('origin-id', 'urn:xmpp:sid:0')?.attrs?.id,
    direction,
    senderJid,
    name: safeText(file.getChildText('name'), 255) || 'sticker',
    altText: safeText(file.getChildText('desc'), 1024),
    fallbackText: safeText(stanza.getChildText('body'), 1024),
    mimeType,
    sizeBytes: String(metadata.sizeBytes),
    width: metadata.width,
    height: metadata.height,
    hashAlgorithm: 'sha-256',
    hashValue: hashFromBase64(hash.getText()),
    remoteUrl,
    transportStatus: 'sent',
    availability: 'missing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost') return true;
  if (net.isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && (parts[1] === 0 || parts[1] === 168)) ||
      (parts[0] === 198 && parts[1] === 18) ||
      parts[0] >= 224;
  }
  if (net.isIP(value) !== 6) return false;
  if (value === '::' || value === '::1' || value.startsWith('fe80:') || value.startsWith('fc') ||
      value.startsWith('fd') || value.startsWith('ff')) return true;
  const dottedMapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (dottedMapped) return isPrivateAddress(dottedMapped[1]);
  const mappedIndex = value.lastIndexOf(':ffff:');
  if (mappedIndex >= 0) {
    const tail = value.slice(mappedIndex + 6).split(':');
    if (tail.length === 2 && tail.every((part) => /^[0-9a-f]{1,4}$/.test(part))) {
      const first = Number.parseInt(tail[0], 16);
      const second = Number.parseInt(tail[1], 16);
      return isPrivateAddress(`${first >>> 8}.${first & 255}.${second >>> 8}.${second & 255}`);
    }
  }
  return false;
}

function validateHttpsUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw stickerError('UNSUPPORTED', 'la fuente remota no es válida', 'sticker.url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw stickerError('UNSUPPORTED', 'solo se permiten fuentes HTTPS seguras', 'sticker.url');
  if (isPrivateAddress(url.hostname)) throw stickerError('UNSUPPORTED', 'la fuente remota no está permitida', 'sticker.url');
  return url.toString();
}

async function assertPublicHost(url, lookup = dns.lookup) {
  const hostname = new URL(url).hostname;
  if (isPrivateAddress(hostname)) throw stickerError('UNSUPPORTED', 'el destino remoto no está permitido', 'sticker.url');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses?.length || addresses.some((entry) => isPrivateAddress(entry.address)))
    throw stickerError('UNSUPPORTED', 'el destino remoto no está permitido', 'sticker.url');
  return addresses;
}

function putHttps(url, body, headers, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const requestHeaders = {};
    for (const [name, value] of options.headerEntries || Object.entries(headers)) {
      if (!Object.hasOwn(requestHeaders, name)) requestHeaders[name] = value;
      else requestHeaders[name] = Array.isArray(requestHeaders[name]) ? [...requestHeaders[name], value] : [requestHeaders[name], value];
    }
    requestHeaders['Content-Type'] = headers['Content-Type'];
    requestHeaders['Content-Length'] = String(body.length);
    const request = https.request(target, {
      method: 'PUT',
      headers: requestHeaders,
      timeout: options.timeoutMs || 15000,
      rejectUnauthorized: true,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode || 0));
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(stickerError('TIMEOUT', 'la carga del sticker expiró', 'sticker.upload')));
    request.end(body);
  });
}

function createXmppStickerService(adapter, options = {}) {
  const discoveries = new Map();
  const attempts = new Map();
  const lookup = options.lookup || dns.lookup;
  const put = options.put || putHttps;
  const readFile = options.readFile || ((filePath) => fsp.readFile(filePath));

  function current(accountId, session, generation) {
    adapter.assertSessionCurrent(accountId, session, generation, adapter.sessionDomains.get(accountId) || '');
  }

  async function requestDisco(session, to, child) {
    return adapter.withTimeout(session.iqCaller.request(xml('iq', { type: 'get', to, id: `sticker_disco_${crypto.randomUUID()}` }, child)), 10000, 'TIMEOUT', 'discovery timeout');
  }

  function parseUploadInfo(response, target) {
    if (!response?.is?.('iq') || response.attrs?.type !== 'result') return undefined;
    const query = response.getChild('query', DISCO_INFO_NS);
    const supported = Boolean(query?.getChildren('feature').some((feature) => feature.attrs?.var === UPLOAD_NS));
    if (!supported) return undefined;
    const field = query.getChild('x', DATAFORM_NS)?.getChildren('field').find((item) => item.attrs?.var === 'max-file-size');
    const rawLimit = field?.getChildText('value');
    const maxFileSize = rawLimit && /^\d+$/.test(rawLimit) ? Number(rawLimit) : undefined;
    return { serviceJid: target, maxFileSize: Number.isSafeInteger(maxFileSize) ? maxFileSize : undefined };
  }

  async function discover(accountId, session, generation) {
    const cached = discoveries.get(accountId);
    if (cached && cached.session === session && cached.generation === generation && cached.expiresAt > Date.now()) return cached.value;
    const domain = adapter.sessionDomains.get(accountId) || '';
    if (!domain) throw stickerError('UNSUPPORTED', 'el dominio XMPP no está disponible', 'sticker.discovery');
    current(accountId, session, generation);
    const itemsResponse = await requestDisco(session, domain, xml('query', { xmlns: DISCO_ITEMS_NS }));
    current(accountId, session, generation);
    const itemTargets = itemsResponse?.getChild('query', DISCO_ITEMS_NS)?.getChildren('item').map((item) => item.attrs?.jid).filter(Boolean) || [];
    const targets = [domain, ...itemTargets.filter((target) => target !== domain)];
    for (const target of targets) {
      const response = await requestDisco(session, target, xml('query', { xmlns: DISCO_INFO_NS }));
      const value = parseUploadInfo(response, target);
      if (value) {
        const result = { ...value, accountId, generation, discoveredAt: new Date().toISOString() };
        discoveries.set(accountId, { session, generation, expiresAt: Date.now() + DISCOVERY_TTL_MS, value: result });
        return result;
      }
    }
    throw stickerError('UNSUPPORTED', 'el servidor no ofrece HTTP Upload compatible', 'sticker.discovery');
  }

  async function requestSlot(accountId, session, generation, service, sticker) {
    current(accountId, session, generation);
    const response = await adapter.withTimeout(session.iqCaller.request(xml(
      'iq', { type: 'get', to: service.serviceJid, id: `sticker_slot_${crypto.randomUUID()}` },
      xml('request', { xmlns: UPLOAD_NS, filename: safeFileName(sticker.name), size: String(sticker.sizeBytes), 'content-type': sticker.mimeType }),
    )), 10000, 'TIMEOUT', 'slot timeout');
    current(accountId, session, generation);
    const slot = response?.getChild('slot', UPLOAD_NS);
    const puts = slot?.getChildren('put', UPLOAD_NS) || [];
    const gets = slot?.getChildren('get', UPLOAD_NS) || [];
    const putElement = puts.length === 1 ? puts[0] : undefined;
    const getElement = gets.length === 1 ? gets[0] : undefined;
    const putUrl = putElement?.attrs?.url;
    const getUrl = getElement?.attrs?.url;
    if (response?.attrs?.type !== 'result' || puts.length !== 1 || gets.length !== 1 || !putUrl || !getUrl)
      throw stickerError('UNSUPPORTED', 'el slot HTTP Upload no es válido', 'sticker.slot');
    const headers = {};
    const headerEntries = [];
    for (const header of putElement.getChildren('header')) {
      const name = String(header.attrs?.name || '').trim();
      const content = String(header.getText() || '').replace(/[\r\n]/g, '');
      const lowerName = name.toLowerCase();
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
          !['authorization', 'cookie', 'expires'].includes(lowerName) || !content) continue;
      headerEntries.push([name, content]);
      if (!Object.hasOwn(headers, name)) headers[name] = content;
      else headers[name] = Array.isArray(headers[name]) ? [...headers[name], content] : [headers[name], content];
    }
    const normalizedPut = validateHttpsUrl(putUrl);
    const normalizedGet = validateHttpsUrl(getUrl);
    const putAddresses = await assertPublicHost(normalizedPut, lookup);
    await assertPublicHost(normalizedGet, lookup);
    const selected = putAddresses[0];
    return {
      putUrl: normalizedPut,
      getUrl: normalizedGet,
      headers,
      headerEntries,
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    };
  }

  return {
    async discover(input) {
      const session = adapter.requireConnected(input.accountId);
      const generation = adapter.sessionGenerations.get(input.accountId) || 0;
      return discover(input.accountId, session, generation);
    },
    async send(input, resolveSource, onState = () => undefined) {
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
          if (Number(source.sizeBytes) !== metadata.sizeBytes || Number(source.width) !== metadata.width || Number(source.height) !== metadata.height)
            throw stickerError('MEDIA_DECODE_FAILED', 'el asset local no coincide con su metadata', 'sticker.source');
          const now = new Date().toISOString();
          const refId = refIdFor(input.accountId, input.conversationId, input.clientMessageId, 'outgoing', input.accountId);
          state = {
            refId,
            previewStickerId: previewStickerId(refId),
            accountId: input.accountId, conversationId: adapter.bareJid(input.conversationId), clientMessageId: input.clientMessageId,
            originId: input.clientMessageId, direction: 'outgoing', senderJid: input.accountId,
            sourceStickerId: input.stickerId, name: source.name, altText: source.altText, mimeType: source.mimeType,
            sizeBytes: String(metadata.sizeBytes), width: metadata.width, height: metadata.height,
            hashAlgorithm: 'sha-256', hashValue: source.hashValue, localAssetId: source.assetId,
            transportStatus: 'uploading', availability: 'available', createdAt: now, updatedAt: now,
          };
          await onState(state);
          current(input.accountId, session, generation);
          const service = await discover(input.accountId, session, generation);
          if (service.maxFileSize !== undefined && metadata.sizeBytes > service.maxFileSize)
            throw stickerError('MEDIA_SIZE_EXCEEDED', 'el servicio de upload no admite este tamaño', 'sticker.slot');
          const slot = await requestSlot(input.accountId, session, generation, service, source);
          const bytes = source.bytes ? Buffer.from(source.bytes) : await readFile(source.path);
          current(input.accountId, session, generation);
          if (bytes.length !== metadata.sizeBytes) throw stickerError('MEDIA_DECODE_FAILED', 'el asset cambió durante la carga', 'sticker.upload');
          const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
          if (actualHash !== String(source.hashValue).toLowerCase())
            throw stickerError('MEDIA_DECODE_FAILED', 'la integridad del asset no coincide', 'sticker.upload');
          const status = await put(slot.putUrl, bytes, { ...slot.headers, 'Content-Type': source.mimeType }, {
            timeoutMs: 15000,
            lookup: slot.lookup,
            headerEntries: slot.headerEntries,
          });
          if (status !== 201) throw stickerError('TRANSPORT_FAILED', 'HTTP Upload no confirmó el recurso', 'sticker.upload');
          current(input.accountId, session, generation);
          state = { ...state, transportStatus: 'sending', updatedAt: new Date().toISOString(), remoteUrl: slot.getUrl };
          await onState(state);
          current(input.accountId, session, generation);
          const stanza = buildStickerMessage({ to: input.conversationId, clientMessageId: input.clientMessageId, sticker: source, sourceUrl: slot.getUrl, fallback: source.altText });
          try {
            await session.send(stanza);
            sendConfirmed = true;
          } catch (cause) {
            throw stickerError('SEND_RESULT_UNKNOWN', 'el resultado del envío XMPP es incierto', 'sticker.send', cause);
          }
          current(input.accountId, session, generation);
          const sentAt = new Date().toISOString();
          state = {
            ...state,
            stanzaId: clientMessageIdOrUndefined(stanza),
            remoteUrl: slot.getUrl,
            fallbackText: safeText(source.altText, 1024),
            transportStatus: 'sent',
            updatedAt: sentAt,
          };
          await onState(state);
          current(input.accountId, session, generation);
          return state;
        } catch (error) {
          if (sendConfirmed && error?.code === 'NOT_CONNECTED') {
            error = stickerError('SEND_RESULT_UNKNOWN', 'el envío se completó antes del cambio de sesión', 'sticker.session', error);
          }
          if (sendConfirmed) error.sendConfirmed = true;
          if (state && !sendConfirmed) {
            try {
              await onState({ ...state, transportStatus: 'failed', errorCode: error?.code || 'TRANSPORT_FAILED', updatedAt: new Date().toISOString() });
            } catch (stateError) {
              error.stateError = stateError;
            }
          }
          throw error;
        }
      })();
      attempts.set(attemptKey, operation);
      try { return await operation; } finally { attempts.delete(attemptKey); }
    },
    parseMessage(accountId, stanza, direction = 'incoming') { return parseStickerMessage(accountId, stanza, direction); },
    handleMessage(accountId, stanza) {
      try {
        const parsed = parseStickerMessage(accountId, stanza, 'incoming');
        if (!parsed) return false;
        adapter.emit({ type: 'sticker.messageReceived', payload: parsed });
      } catch (error) {
        if (stanza?.getChild?.('sticker', STICKERS_NS) && process.env.ATOMIC_XMPP_DEBUG === 'true')
          console.warn('[XMPP_STICKER] Ignoring invalid sticker stanza:', error?.code || error?.message);
      }
      return true;
    },
    clear(accountId) { discoveries.delete(accountId); for (const key of attempts.keys()) if (key.startsWith(`${accountId}|`)) attempts.delete(key); },
  };
}

function clientMessageIdOrUndefined(stanza) { return stanza?.attrs?.id; }

module.exports = {
  DATAFORM_NS, DISCO_INFO_NS, DISCO_ITEMS_NS, FALLBACK_NS, FILE_NS, HASHES_NS, MAX_STICKER_BYTES, MAX_DIMENSION,
  SFS_NS, STICKERS_NS, UPLOAD_NS, URL_DATA_NS, buildStickerMessage, createXmppStickerService, hashFromBase64,
  isPrivateAddress, parseStickerMessage, previewStickerId, refIdFor, validateHttpsUrl,
};
