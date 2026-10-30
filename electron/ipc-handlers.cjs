const { createIpcHelpers } = require('./ipc-helpers.cjs');
const { registerAccountHandlers } = require('./ipc-account-handlers.cjs');
const { registerFileHandlers } = require('./ipc-file-handlers.cjs');
const { registerHistoryHandlers } = require('./ipc-history-handlers.cjs');
const { registerMucHandlers } = require('./ipc-muc-handlers.cjs');
const { registerPreferenceHandlers } = require('./ipc-preference-handlers.cjs');
const { registerConnectionProfileHandlers } = require('./ipc-connection-profile-handlers.cjs');
const { registerAttentionHandlers } = require('./ipc-attention-handlers.cjs');
const { registerBroadcastHandlers } = require('./ipc-broadcast-handlers.cjs');

function registerIpcHandlers(options) {
  const helpers = createIpcHelpers(options);
  const dependencies = { ...options, helpers };
  registerAccountHandlers(dependencies);
  registerBroadcastHandlers(dependencies);
  registerMucHandlers(dependencies);
  registerFileHandlers(dependencies);
  registerHistoryHandlers(dependencies);
  registerPreferenceHandlers(dependencies);
  registerConnectionProfileHandlers(dependencies);
  registerAttentionHandlers(dependencies);
}

module.exports = { registerIpcHandlers };
