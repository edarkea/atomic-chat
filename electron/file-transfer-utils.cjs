const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

function transferError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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
