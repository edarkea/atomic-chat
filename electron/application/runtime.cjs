const { createHistoryRepository } = require('./history-repository.cjs');

function loadMucPolicies(environment = process.env) {
  try {
    const parsed = JSON.parse(environment.ATOMIC_XMPP_MUC_POLICY_JSON || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (policy) =>
            policy &&
            typeof policy.accountId === 'string' &&
            typeof policy.service === 'string' &&
            policy.canCreate === false &&
            policy.source === 'operator' &&
            typeof policy.evidence === 'string' &&
            policy.evidence.trim() &&
            policy.endpoint &&
            typeof policy.endpoint.host === 'string' &&
            policy.endpoint.host.trim() &&
            Number.isInteger(policy.endpoint.port) &&
            ['starttls', 'direct-tls'].includes(policy.endpoint.transport),
        )
      : [];
  } catch {
    return [];
  }
}

function hasMucOperatorConfiguration(environment = process.env) {
  return (
    typeof environment.ATOMIC_XMPP_MUC_POLICY_JSON === 'string' &&
    environment.ATOMIC_XMPP_MUC_POLICY_JSON.trim().length > 0
  );
}

function startRuntimeReconciliation(media, stickers, logger = console) {
  return Promise.allSettled([media.reconcile(), stickers.reconcile()]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected')
        logger.error('[RUNTIME-RECONCILIATION-FAILED]', result.reason);
    }
    return results;
  });
}

function createRuntime({
  app,
  safeStorage,
  PersistenceStore,
  SecretStore,
  XmppAdapter,
  MediaStore,
  FileHistoryStore,
  StickerStore,
  StickerPackStore,
  StickerMessageStore,
  nativeImage,
  fileTransfers,
  outgoingFileTransfers,
  shell,
  stickerStorageProvider = null,
  stickerStorageConfiguration = null,
  environment = process.env,
}) {
  const persistence = new PersistenceStore(app.getPath('userData'));
  const media = new MediaStore(app.getPath('userData'), persistence, nativeImage);
  const history = createHistoryRepository({ persistence, media });
  const fileHistory = new FileHistoryStore(persistence, shell);
  const stickers = new StickerStore(app.getPath('userData'), persistence, nativeImage);
  const stickerPacks = new StickerPackStore(persistence);
  const stickerMessages = new StickerMessageStore(
    app.getPath('userData'),
    persistence,
    nativeImage,
    {
      assetStore: stickers,
      stickerStore: stickers,
      storageProvider: stickerStorageProvider,
    },
  );
  const reconciliation = startRuntimeReconciliation(media, stickers);
  const secrets = new SecretStore(safeStorage, app.getPath('userData'));
  const xmpp = new XmppAdapter(
    app.isPackaged,
    persistence,
    loadMucPolicies(environment),
    fileTransfers,
    outgoingFileTransfers,
    stickerStorageProvider,
    stickerStorageConfiguration,
    hasMucOperatorConfiguration(environment),
  );
  return {
    persistence,
    history,
    media,
    fileHistory,
    stickers,
    stickerPacks,
    stickerMessages,
    secrets,
    xmpp,
    reconciliation,
  };
}

module.exports = {
  createRuntime,
  hasMucOperatorConfiguration,
  loadMucPolicies,
  startRuntimeReconciliation,
};
