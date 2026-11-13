// @ts-check

/** @typedef {'incoming' | 'outgoing'} TransferDirection */

/**
 * @typedef {Object} TransferReservation
 * @property {string} accountId
 * @property {TransferDirection} direction
 */

/**
 * @typedef {Object} ResourceCounts
 * @property {number} account
 * @property {number} global
 */

/** @typedef {Error & {code: 'RESOURCE_CONSTRAINT'}} ResourceConstraintError */

const ACTIVE_PER_ACCOUNT = 2;
const ACTIVE_GLOBAL = 4;

/**
 * @param {string} [message]
 * @returns {ResourceConstraintError}
 */
function constraintError(message = 'active transfer capacity exceeded') {
  const error = /** @type {ResourceConstraintError} */ (new Error(message));
  error.code = 'RESOURCE_CONSTRAINT';
  return error;
}

class TransferResourceLimiter {
  constructor() {
    /** @type {Map<string, TransferReservation>} */
    this.reservations = new Map();
  }

  /**
   * @param {string} transferId
   * @param {string} accountId
   * @param {TransferDirection} direction
   * @returns {true}
   */
  reserve(transferId, accountId, direction) {
    const existing = this.reservations.get(transferId);
    if (existing) {
      if (existing.accountId !== accountId || existing.direction !== direction)
        throw constraintError('transfer reservation conflict');
      return true;
    }
    const accountCount = [...this.reservations.values()].filter(
      (reservation) => reservation.accountId === accountId,
    ).length;
    if (accountCount >= ACTIVE_PER_ACCOUNT || this.reservations.size >= ACTIVE_GLOBAL)
      throw constraintError();
    this.reservations.set(transferId, { accountId, direction });
    return true;
  }

  /** @param {string} transferId */
  release(transferId) {
    this.reservations.delete(transferId);
  }

  /**
   * @param {string} accountId
   * @returns {ResourceCounts}
   */
  counts(accountId) {
    return {
      account: [...this.reservations.values()].filter(
        (reservation) => reservation.accountId === accountId,
      ).length,
      global: this.reservations.size,
    };
  }
}

module.exports = { TransferResourceLimiter, constraintError };
