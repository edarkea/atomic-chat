const crypto = require('node:crypto');

const SI_NS = 'http://jabber.org/protocol/si';
const SI_FILE_NS = 'http://jabber.org/protocol/si/profile/file-transfer';
const FEATURE_NEG_NS = 'http://jabber.org/protocol/feature-neg';
const DATAFORM_NS = 'jabber:x:data';
const IBB_NS = 'http://jabber.org/protocol/ibb';
const MAX_BLOCK = 65535;

/**
 * @typedef {Error & {code: string}} ProtocolError
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, getChild?: (name: string, namespace?: string) => XmlNode | undefined, getChildren?: (name?: string, namespace?: string) => XmlNode[], getChildText?: (name: string, namespace?: string) => string | undefined, getText?: () => string | undefined}} XmlNode
 */

/** @param {unknown} value */
function canonicalDecimal(value) {
  return typeof value === 'string' && (value === '0' || /^[1-9][0-9]*$/.test(value));
}

/** @param {unknown} value */
function safeName(value) {
  const base =
    String(value || '')
      .replace(/[\u0000-\u001f\u007f]/g, '_')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim() || 'received-file';
  return Buffer.from(base, 'utf8')
    .subarray(0, 255)
    .toString('utf8')
    .replace(/\uFFFD/g, '_');
}

/**
 * @param {unknown} value
 * @returns {Buffer}
 */
function strictBase64(value) {
  if (
    typeof value !== 'string' ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error('INVALID_BASE64');
  return Buffer.from(value, 'base64');
}

/** @param {string} code @returns {ProtocolError} */
function protocolError(code) {
  return Object.assign(new Error(code), { code });
}

/**
 * @param {XmlNode | undefined} node
 * @param {string} name
 * @param {string} namespace
 * @returns {XmlNode | undefined}
 */
function child(node, name, namespace) {
  return node?.getChild?.(name, namespace);
}

/**
 * @param {XmlNode} iq
 * @param {string} accountId
 * @param {number} generation
 */
function parseOffer(iq, accountId, generation) {
  const from = String(iq?.attrs?.['from'] || '');
  const iqType = iq?.attrs?.['type'];
  const iqId = iq?.attrs?.['id'];
  if (!from.includes('/') || iqType !== 'set' || !iqId) throw protocolError('BAD_REQUEST');
  const si = child(iq, 'si', SI_NS);
  const profile = si?.attrs?.['profile'];
  const file = child(si, 'file', SI_FILE_NS);
  const size = file?.attrs?.['size'];
  const name = file?.attrs?.['name'];
  const methods =
    child(si, 'feature', FEATURE_NEG_NS)?.getChild?.('x', DATAFORM_NS)?.getChildren?.('field') ||
    [];
  const hasIbb = methods.some(
    (field) =>
      field.attrs?.['var'] === 'stream-method' &&
      [
        ...(field.getChildren?.('value') || []),
        ...(field.getChildren?.('option') || []).flatMap(
          (option) => option.getChildren?.('value') || [],
        ),
      ].some((value) => value.getText?.() === IBB_NS),
  );
  const siId = si?.attrs?.['id'];
  if (!siId || profile !== SI_FILE_NS || !file || !name || !canonicalDecimal(size))
    throw protocolError('BAD_REQUEST');
  if (!hasIbb) throw protocolError('UNSUPPORTED_METHOD');
  return {
    accountId,
    generation,
    iqId: String(iqId),
    siSid: String(siId),
    senderJid: from,
    conversationId: from.split('/')[0].toLowerCase(),
    name: safeName(name),
    sizeBytes: size,
    description: file.getChildText?.('desc')?.slice(0, 1024),
    transferId: `file_${crypto.randomUUID()}`,
  };
}

/**
 * @param {XmlNode | undefined} open
 * @param {string} expectedSid
 * @param {string} senderJid
 * @returns {number}
 */
function validateOpen(open, expectedSid, senderJid) {
  if (
    !open ||
    open.attrs?.['xmlns'] !== IBB_NS ||
    open.attrs?.['sid'] !== expectedSid ||
    open.attrs?.['stanza'] === 'message'
  )
    throw new Error('BAD_REQUEST');
  const blockSize = Number(open.attrs?.['block-size']);
  if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > MAX_BLOCK)
    throw new Error('RESOURCE_CONSTRAINT');
  return blockSize;
}

/**
 * @param {XmlNode | undefined} data
 * @param {string} sid
 * @param {string} senderJid
 * @param {number} blockSize
 * @param {number} expectedSeq
 * @returns {Buffer}
 */
function validateData(data, sid, senderJid, blockSize, expectedSeq) {
  if (!data || data.attrs?.['xmlns'] !== IBB_NS || data.attrs?.['sid'] !== sid)
    throw new Error('BAD_REQUEST');
  const seq = Number(data.attrs?.['seq']);
  if (!Number.isInteger(seq) || seq !== expectedSeq) throw new Error('BAD_REQUEST');
  const bytes = strictBase64(data.getText?.() || '');
  if (bytes.length > blockSize || bytes.length > MAX_BLOCK) throw new Error('RESOURCE_CONSTRAINT');
  return bytes;
}
module.exports = {
  SI_NS,
  SI_FILE_NS,
  FEATURE_NEG_NS,
  DATAFORM_NS,
  IBB_NS,
  canonicalDecimal,
  safeName,
  strictBase64,
  parseOffer,
  validateOpen,
  validateData,
};
