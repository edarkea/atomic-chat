const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const path = require('node:path');
const STICKERS_NS = 'urn:xmpp:stickers:0';
const SFS_NS = 'urn:xmpp:sfs:0';
const FILE_NS = 'urn:xmpp:file:metadata:0';
const HASHES_NS = 'urn:xmpp:hashes:2';
const URL_DATA_NS = 'http://jabber.org/protocol/url-data';
const FALLBACK_NS = 'urn:xmpp:fallback:0';
const STORAGE_NS = 'urn:atomic:sticker-storage:0';
const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1024;

/**
 * @typedef {Error & {code: string, phase: string, cause?: unknown}} StickerError
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildText: (name: string, namespace?: string) => string | undefined, getText: () => string | undefined}} XmlNode
 * @typedef {{mimeType?: unknown, sizeBytes?: unknown, width?: unknown, height?: unknown, hashValue?: unknown, name?: unknown, altText?: unknown}} StickerInput
 * @typedef {{to: unknown, clientMessageId: unknown, sticker: StickerInput, sourceUrl: unknown, fallback: unknown, packId?: unknown, storageProviderId?: unknown, storageOrigin?: unknown}} BuildStickerMessageInput
 * @typedef {{address: string, family?: number}} ResolvedAddress
 * @typedef {(hostname: string, options: {all: true}) => Promise<ResolvedAddress[]>} AddressLookup
 */

const xmppClient = require('@xmpp/client');
const xml =
  /** @type {(name: string, ...children: Array<XmlAttributes | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

/**
 * @param {string} code
 * @param {string} message
 * @param {string} phase
 * @param {unknown} [originalCause]
 * @returns {StickerError}
 */
function stickerError(code, message, phase, originalCause) {
  const error = new Error(message);
  return Object.assign(error, {
    code,
    phase,
    ...(originalCause ? { cause: originalCause } : {}),
  });
}

/** @param {string} hashValue @returns {string} */
function hashToBase64(hashValue) {
  if (!/^[a-f0-9]{64}$/i.test(hashValue))
    throw stickerError('INVALID_INPUT', 'hash inválido', 'sticker.hash');
  return Buffer.from(hashValue, 'hex').toString('base64');
}

/** @param {unknown} value @returns {string} */
function hashFromBase64(value) {
  const decoded = Buffer.from(String(value || ''), 'base64');
  if (decoded.length !== 32)
    throw stickerError('INVALID_INPUT', 'hash sha-256 inválido', 'sticker.parse');
  return decoded.toString('hex');
}

/**
 * @param {unknown} value
 * @param {number} [max=512]
 * @returns {string | undefined}
 */
function safeText(value, max = 512) {
  const text = String(value || '').trim();
  return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : undefined;
}

/** @param {unknown} value @returns {string} */
function safeFileName(value) {
  const name = path
    .basename(String(value || 'sticker.png'))
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_');
  return name.slice(0, 255) || 'sticker.png';
}

/** @param {string} accountId @param {string} conversationId @param {string} clientMessageId @returns {string} */
function messageIdentity(accountId, conversationId, clientMessageId) {
  return crypto
    .createHash('sha256')
    .update(`${accountId}|${conversationId}|${clientMessageId}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * @param {string} accountId
 * @param {string} conversationId
 * @param {string} clientMessageId
 * @param {'incoming' | 'outgoing'} [direction='outgoing']
 * @param {string} [senderJid=accountId]
 * @returns {string}
 */
function refIdFor(
  accountId,
  conversationId,
  clientMessageId,
  direction = 'outgoing',
  senderJid = accountId,
) {
  return `sticker_message_${messageIdentity(accountId, conversationId, `${direction}|${senderJid}|${clientMessageId}`)}`;
}

/** @param {string} refId @returns {string} */
function previewStickerId(refId) {
  return `message:${refId}`;
}

/**
 * @param {StickerInput} sticker
 * @returns {{width: number, height: number}}
 */
function dimensionsFor(sticker) {
  const width = Number(sticker.width);
  const height = Number(sticker.height);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  )
    throw stickerError('MEDIA_DIMENSIONS_INVALID', 'dimensiones no permitidas', 'sticker.validate');
  return { width, height };
}

/**
 * @param {StickerInput} sticker
 * @returns {{sizeBytes: number, width: number, height: number}}
 */
function validateStickerMetadata(sticker) {
  if (
    !sticker ||
    typeof sticker.mimeType !== 'string' ||
    !['image/png', 'image/jpeg'].includes(sticker.mimeType)
  )
    throw stickerError(
      'MEDIA_TYPE_UNSUPPORTED',
      'solo se permiten PNG/JPEG estáticos',
      'sticker.validate',
    );
  const sizeBytes = Number(sticker.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_STICKER_BYTES)
    throw stickerError(
      'MEDIA_SIZE_EXCEEDED',
      'el sticker supera el límite permitido',
      'sticker.validate',
    );
  const dimensions = dimensionsFor(sticker);
  if (!/^[a-f0-9]{64}$/i.test(String(sticker.hashValue || '')))
    throw stickerError(
      'MEDIA_DECODE_FAILED',
      'el hash del sticker no es válido',
      'sticker.validate',
    );
  return { sizeBytes, ...dimensions };
}

/**
 * @param {BuildStickerMessageInput} input
 * @returns {XmlNode}
 */
function buildStickerMessage({
  to,
  clientMessageId,
  sticker,
  sourceUrl,
  fallback,
  packId,
  storageProviderId,
  storageOrigin,
}) {
  if (!safeText(to, 512) || !safeText(clientMessageId, 512))
    throw stickerError(
      'INVALID_INPUT',
      'destinatario o correlación inválidos',
      'sticker.serialize',
    );
  const metadata = validateStickerMetadata(sticker);
  const mimeType = /** @type {string} */ (sticker.mimeType);
  const hashValue = /** @type {string} */ (sticker.hashValue);
  const recipient = safeText(to, 512);
  const messageId = safeText(clientMessageId, 512);
  if (!recipient || !messageId)
    throw stickerError(
      'INVALID_INPUT',
      'destinatario o correlación inválidos',
      'sticker.serialize',
    );
  const target = validateHttpsUrl(sourceUrl);
  const fileChildren = [
    xml('media-type', {}, mimeType),
    xml('name', {}, safeFileName(sticker.name)),
    xml('size', {}, String(metadata.sizeBytes)),
    xml('width', {}, String(metadata.width)),
    xml('height', {}, String(metadata.height)),
    xml('hash', { xmlns: HASHES_NS, algo: 'sha-256' }, hashToBase64(hashValue)),
  ];
  const description = safeText(sticker.altText, 1024);
  if (description) fileChildren.push(xml('desc', {}, description));
  const sharingChildren = [
    xml('file', { xmlns: FILE_NS }, ...fileChildren),
    xml('sources', {}, xml('url-data', { xmlns: URL_DATA_NS, target })),
  ];
  const providerId = safeText(storageProviderId, 128);
  const origin = safeText(storageOrigin, 512);
  if (providerId && origin)
    sharingChildren.push(
      xml('provider', {
        xmlns: STORAGE_NS,
        id: providerId,
        origin,
      }),
    );
  return xml(
    'message',
    { type: 'chat', to: recipient.trim(), id: messageId.trim() },
    xml('sticker', { xmlns: STICKERS_NS, ...(packId ? { pack: safeText(packId, 512) } : {}) }),
    xml(
      'file-sharing',
      { xmlns: SFS_NS, disposition: 'inline', id: `sticker-${messageId}` },
      ...sharingChildren,
    ),
    xml('fallback', { xmlns: FALLBACK_NS, for: SFS_NS }, xml('body')),
    xml('body', {}, safeText(fallback, 1024) || description || 'Sticker'),
    xml('origin-id', { xmlns: 'urn:xmpp:sid:0', id: messageId.trim() }),
  );
}

/**
 * @param {XmlNode} file
 * @returns {{width: number, height: number}}
 */
function parseDimensions(file) {
  const width = Number(file.getChildText('width'));
  const height = Number(file.getChildText('height'));
  if (Number.isInteger(width) && Number.isInteger(height)) return { width, height };
  const dimensions = /^([0-9]+)x([0-9]+)$/.exec(file.getChildText('dimensions') || '');
  if (!dimensions)
    throw stickerError('MEDIA_DIMENSIONS_INVALID', 'faltan dimensiones válidas', 'sticker.parse');
  return { width: Number(dimensions[1]), height: Number(dimensions[2]) };
}

/**
 * @param {string} accountId
 * @param {XmlNode} stanza
 * @param {'incoming' | 'outgoing'} [direction='incoming']
 */
function parseStickerMessage(accountId, stanza, direction = 'incoming') {
  const stickerElement = stanza?.getChild?.('sticker', STICKERS_NS);
  const sharing = stanza?.getChild?.('file-sharing', SFS_NS);
  if (!stickerElement || !sharing) return null;
  const file = sharing.getChild('file', FILE_NS);
  const mimeType = file?.getChildText('media-type');
  const sizeBytes = file?.getChildText('size');
  const hash = file?.getChild('hash', HASHES_NS);
  const source = sharing.getChild('sources')?.getChild('url-data', URL_DATA_NS)?.attrs?.['target'];
  const provider = sharing.getChild('provider', STORAGE_NS);
  if (!file || !mimeType || !sizeBytes || !hash || hash.attrs?.['algo'] !== 'sha-256' || !source)
    throw stickerError('INVALID_INPUT', 'metadata de sticker incompleta', 'sticker.parse');
  const dimensions = parseDimensions(file);
  const clientMessageId =
    stanza.attrs?.['id'] || stanza.getChild('origin-id', 'urn:xmpp:sid:0')?.attrs?.['id'];
  const conversationId = String(
    direction === 'outgoing' ? stanza.attrs?.['to'] : stanza.attrs?.['from'] || '',
  ).split('/')[0];
  const senderJid = String(
    direction === 'outgoing' ? accountId : stanza.attrs?.['from'] || '',
  ).split('/')[0];
  if (!clientMessageId || !conversationId || !senderJid)
    throw stickerError('INVALID_INPUT', 'sticker sin identidad XMPP', 'sticker.parse');
  const hashValue = hashFromBase64(hash.getText());
  const metadata = validateStickerMetadata({ mimeType, sizeBytes, ...dimensions, hashValue });
  const remoteUrl = validateHttpsUrl(source);
  const refId = refIdFor(accountId, conversationId, clientMessageId, direction, senderJid);
  return {
    refId,
    previewStickerId: previewStickerId(refId),
    accountId,
    conversationId,
    clientMessageId,
    stanzaId: stanza.attrs?.['id'],
    originId: stanza.getChild('origin-id', 'urn:xmpp:sid:0')?.attrs?.['id'],
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
    hashValue,
    remoteUrl,
    ...(safeText(provider?.attrs?.['id'], 128)
      ? { storageProviderId: safeText(provider?.attrs?.['id'], 128) }
      : {}),
    ...(safeText(provider?.attrs?.['origin'], 512)
      ? { storageOrigin: safeText(provider?.attrs?.['origin'], 512) }
      : {}),
    transportStatus: 'sent',
    availability: 'missing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** @param {unknown} address @returns {boolean} */
function isPrivateAddress(address) {
  const value = String(address || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (value === 'localhost') return true;
  if (net.isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    )
      return true;
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && (parts[1] === 0 || parts[1] === 168)) ||
      (parts[0] === 198 && parts[1] === 18) ||
      parts[0] >= 224
    );
  }
  if (net.isIP(value) !== 6) return false;
  if (
    value === '::' ||
    value === '::1' ||
    value.startsWith('fe80:') ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('ff')
  )
    return true;
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

/** @param {unknown} value @returns {string} */
function validateHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw stickerError('UNSUPPORTED', 'la fuente remota no es válida', 'sticker.url');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw stickerError('UNSUPPORTED', 'solo se permiten fuentes HTTPS seguras', 'sticker.url');
  if (isPrivateAddress(url.hostname))
    throw stickerError('UNSUPPORTED', 'la fuente remota no está permitida', 'sticker.url');
  return url.toString();
}

/**
 * @param {string} url
 * @param {AddressLookup} [lookup=dns.lookup]
 * @returns {Promise<ResolvedAddress[]>}
 */
async function assertPublicHost(url, lookup = dns.lookup) {
  const hostname = new URL(url).hostname;
  if (isPrivateAddress(hostname))
    throw stickerError('UNSUPPORTED', 'el destino remoto no está permitido', 'sticker.url');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses?.length || addresses.some((entry) => isPrivateAddress(entry.address)))
    throw stickerError('UNSUPPORTED', 'el destino remoto no está permitido', 'sticker.url');
  return addresses;
}

module.exports = {
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
};
