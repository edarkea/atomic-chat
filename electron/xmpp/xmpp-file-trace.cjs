const crypto = require('node:crypto');
const { SI_NS, IBB_NS } = require('../files/file-protocol.cjs');

const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, name?: string, is?: (name: string) => boolean, getChild?: (name: string, namespace?: string) => XmlNode | undefined, getChildText?: (name: string, namespace?: string) => string | undefined, getName?: () => string}} XmlNode
 * @typedef {{fileTraceAttempts: WeakMap<object, string>}} FileTraceAdapter
 * @typedef {{on: (event: string, listener: (value?: XmlNode) => void) => void, removeListener?: (event: string, listener: (value?: XmlNode) => void) => void}} XmppSession
 */

/**
 * @param {string} phase
 * @param {string} direction
 * @param {Record<string, unknown>} [details={}]
 * @returns {void}
 */
function fileTrace(phase, direction, details = {}) {
  if (process.env['ATOMIC_XMPP_FILE_TRACE'] !== 'true') return;
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
  /** @type {Record<string, unknown>} */
  const safe = { phase, direction, at: new Date().toISOString() };
  for (const [key, value] of Object.entries(details)) if (allowed.has(key)) safe[key] = value;
  console.info('[XMPP_FILE_TRACE]', JSON.stringify(safe));
}

/** @param {FileTraceAdapter} adapter */
function createFileTraceService(adapter) {
  return {
    /**
     * @param {string} phase
     * @param {string} direction
     * @param {Record<string, unknown>} [details={}]
     * @returns {void}
     */
    trace(phase, direction, details = {}) {
      fileTrace(phase, direction, details);
    },
    /** @param {string} accountId @param {XmlNode} stanza @returns {void} */
    traceStanza(accountId, stanza) {
      if (
        process.env['ATOMIC_XMPP_FILE_TRACE'] === 'true' &&
        stanza?.is?.('iq') &&
        stanza.attrs?.['type'] === 'set' &&
        stanza.getChild?.('si', SI_NS)
      ) {
        const correlation = `attempt_${crypto.randomUUID()}`;
        adapter.fileTraceAttempts.set(stanza, correlation);
        fileTrace('FILE_IQ_CANDIDATE_RX', 'RX', { iqType: 'set', correlation });
      }
      if (process.env['ATOMIC_XMPP_DEBUG'] === 'true')
        console.debug(
          '[XMPP_STANZA]',
          JSON.stringify({
            accountId,
            from: stanza.attrs?.['from'] || '',
            to: stanza.attrs?.['to'] || '',
            type: stanza.name || stanza.attrs?.['type'] || '',
            id: stanza.attrs?.['id'] || '',
            hasBody: Boolean(stanza.getChildText?.('body')),
          }),
        );
    },
    /**
     * @param {XmppSession} session
     * @param {XmlNode} request
     * @param {unknown} response
     * @returns {void}
     */
    observeFileIqReply(session, request, response) {
      if (process.env['ATOMIC_XMPP_FILE_TRACE'] !== 'true' || !session?.on) return;
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
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        session.removeListener?.('send', onSend);
        session.removeListener?.('error', onError);
      };
      /** @param {XmlNode | undefined} sent */
      const onSend = (sent) => {
        if (!sent?.is?.('iq') || sent.attrs?.['id'] !== request.attrs?.['id']) return;
        fileTrace(`${phase}_TX_FULFILLED`, 'TX', {
          iqType: sent.attrs?.['type'],
          result: sent.attrs?.['type'] === 'result' ? 'sent' : undefined,
          correlation,
        });
        cleanup();
      };
      const onError = () => {
        fileTrace(`${phase}_TX_FAILED`, 'TX', {
          iqType: request.attrs?.['type'],
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
  };
}

module.exports = { createFileTraceService };
