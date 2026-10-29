// @ts-check

/**
 * @typedef {'selecting' | 'offering' | 'awaiting_acceptance' | 'offered' | 'accepted' | 'transferring' | 'completed' | 'failed' | 'cancelled'} TransferState
 */

/** @typedef {'incoming' | 'outgoing'} TransferDirection */

/** @typedef {'completed' | 'failed' | 'cancelled'} TerminalTransferState */

/**
 * @typedef {'user_rejected' | 'cancelled_by_receiver' | 'cancelled_by_sender' | 'timed_out' | 'network_lost' | 'unsupported_method' | 'resource_limit' | 'invalid_protocol' | 'integrity_failed' | 'storage_failed'} TransferEndReason
 */

/**
 * @typedef {Object} TransferOffer
 * @property {string} transferId
 * @property {string} accountId
 * @property {string} conversationId
 * @property {string} senderJid
 * @property {string} [recipientJid]
 * @property {string} name
 * @property {string} sizeBytes Decimal byte count; it must not be converted to a number.
 * @property {string} [mimeType]
 * @property {string} [description]
 * @property {'ibb'} transport
 * @property {string} offeredAt
 */

/**
 * @typedef {Object} TransferRecord
 * @property {TransferOffer} offer
 * @property {TransferState} state
 * @property {bigint} bytes
 * @property {TransferEndReason} [endReason]
 * @property {string} [errorCode]
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} TransferView
 * @property {TransferOffer} offer
 * @property {TransferDirection} direction
 * @property {TransferState} state
 * @property {string} bytesTransferred Decimal byte count serialized from bigint.
 * @property {TransferEndReason} [endReason]
 * @property {string} [errorCode]
 * @property {string} updatedAt
 */

/** @typedef {Error & {code: string}} TransferError */

/** @type {ReadonlySet<string>} */
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

/**
 * @param {unknown} state
 * @returns {state is TerminalTransferState}
 */
function isTerminalState(state) {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {TransferError}
 */
function transferError(code, message) {
  const error = /** @type {TransferError} */ (new Error(message));
  error.code = code;
  return error;
}

/**
 * @param {TransferRecord} record
 * @param {TransferDirection} direction
 * @returns {TransferView}
 */
function transferView(record, direction) {
  return {
    offer: record.offer,
    direction,
    state: record.state,
    bytesTransferred: record.bytes.toString(),
    ...(record.endReason ? { endReason: record.endReason } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    updatedAt: record.updatedAt,
  };
}

module.exports = { TERMINAL_STATES, isTerminalState, transferError, transferView };
