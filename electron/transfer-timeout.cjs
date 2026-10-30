const TRANSFER_TIMEOUT_SECONDS = Object.freeze([60, 180, 300, 600]);
const DEFAULT_TRANSFER_TIMEOUT_SECONDS = 300;

function isTransferTimeout(value) {
  return Number.isInteger(value) && TRANSFER_TIMEOUT_SECONDS.includes(value);
}

function normalizeTransferTimeout(value) {
  return isTransferTimeout(value) ? value : DEFAULT_TRANSFER_TIMEOUT_SECONDS;
}

module.exports = {
  DEFAULT_TRANSFER_TIMEOUT_SECONDS,
  TRANSFER_TIMEOUT_SECONDS,
  isTransferTimeout,
  normalizeTransferTimeout,
};
