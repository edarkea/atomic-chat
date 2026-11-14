const { registerAccountHandlers } = require('./ipc-account-handlers.cjs');
const { registerFileHandlers } = require('./ipc-file-handlers.cjs');
const { registerHistoryHandlers } = require('./ipc-history-handlers.cjs');
const { registerMucHandlers } = require('./ipc-muc-handlers.cjs');
const { registerPreferenceHandlers } = require('./ipc-preference-handlers.cjs');
const { registerConnectionProfileHandlers } = require('./ipc-connection-profile-handlers.cjs');
const { registerAttentionHandlers } = require('./ipc-attention-handlers.cjs');
const { registerBroadcastHandlers } = require('./ipc-broadcast-handlers.cjs');
const { registerPreviewHandlers } = require('./ipc-preview-handlers.cjs');
const { registerFileHistoryHandlers } = require('./ipc-file-history-handlers.cjs');
const { registerStickerHandlers } = require('./ipc-sticker-handlers.cjs');
const { registerStickerPackHandlers } = require('./ipc-sticker-pack-handlers.cjs');
const { registerStickerMessageHandlers } = require('./ipc-sticker-message-handlers.cjs');
const { registerUpdateHandlers } = require('./ipc-update-handlers.cjs');
const { registerExternalLinkHandlers } = require('./ipc-external-link-handlers.cjs');
const { registerGameHandlers } = require('./ipc-game-handlers.cjs');

const IPC_USE_CASES = Object.freeze([
  Object.freeze({ name: 'account', register: registerAccountHandlers }),
  Object.freeze({ name: 'broadcast', register: registerBroadcastHandlers }),
  Object.freeze({ name: 'muc', register: registerMucHandlers }),
  Object.freeze({ name: 'file', register: registerFileHandlers }),
  Object.freeze({ name: 'preview', register: registerPreviewHandlers }),
  Object.freeze({ name: 'file-history', register: registerFileHistoryHandlers }),
  Object.freeze({ name: 'stickers', register: registerStickerHandlers }),
  Object.freeze({ name: 'sticker-packs', register: registerStickerPackHandlers }),
  Object.freeze({ name: 'sticker-messages', register: registerStickerMessageHandlers }),
  Object.freeze({ name: 'history', register: registerHistoryHandlers }),
  Object.freeze({ name: 'preferences', register: registerPreferenceHandlers }),
  Object.freeze({ name: 'connection-profiles', register: registerConnectionProfileHandlers }),
  Object.freeze({ name: 'attention', register: registerAttentionHandlers }),
  Object.freeze({ name: 'updates', register: registerUpdateHandlers }),
  Object.freeze({ name: 'external-links', register: registerExternalLinkHandlers }),
  Object.freeze({ name: 'games', register: registerGameHandlers }),
]);

function registerIpcUseCases(dependencies) {
  for (const useCase of IPC_USE_CASES) useCase.register(dependencies);
}

module.exports = { IPC_USE_CASES, registerIpcUseCases };
