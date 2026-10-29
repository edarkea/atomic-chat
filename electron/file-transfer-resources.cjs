const ACTIVE_PER_ACCOUNT = 2;
const ACTIVE_GLOBAL = 4;

function constraintError(message = 'active transfer capacity exceeded') {
  const error = new Error(message);
  error.code = 'RESOURCE_CONSTRAINT';
  return error;
}

class TransferResourceLimiter {
  constructor() {
    this.reservations = new Map();
  }

  reserve(transferId, accountId, direction) {
    const existing = this.reservations.get(transferId);
    if (existing) {
      if (existing.accountId !== accountId || existing.direction !== direction) throw constraintError('transfer reservation conflict');
      return true;
    }
    const accountCount = [...this.reservations.values()].filter((reservation) => reservation.accountId === accountId).length;
    if (accountCount >= ACTIVE_PER_ACCOUNT || this.reservations.size >= ACTIVE_GLOBAL) throw constraintError();
    this.reservations.set(transferId, { accountId, direction });
    return true;
  }

  release(transferId) {
    this.reservations.delete(transferId);
  }

  counts(accountId) {
    return {
      account: [...this.reservations.values()].filter((reservation) => reservation.accountId === accountId).length,
      global: this.reservations.size,
    };
  }
}

module.exports = { TransferResourceLimiter, constraintError };
