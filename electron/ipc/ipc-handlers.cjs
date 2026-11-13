const { createIpcHelpers } = require('./ipc-helpers.cjs');
const { registerIpcUseCases } = require('./ipc-use-case-registry.cjs');

function registerIpcHandlers(options) {
  const helpers = createIpcHelpers(options);
  registerIpcUseCases({ ...options, helpers });
}

module.exports = { registerIpcHandlers };
