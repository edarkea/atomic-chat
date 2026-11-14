const { createHistoryRepository } = require('./history-repository.cjs');
const { GameRegistry } = require('../games/game-registry.cjs');
const { GameSessionManager } = require('../games/game-session-manager.cjs');
const { GameStorage } = require('../persistence/game-storage.cjs');
const { limitsFromEnvironment } = require('../games/game-limits.cjs');

function createOfficialGameRegistry(compiledGameRules, RegistryConstructor = GameRegistry) {
  const registry = new RegistryConstructor();
  registry.registerOfficial(
    {
      gameId: compiledGameRules.TIC_TAC_TOE_GAME_ID,
      displayName: 'Tic-Tac-Toe',
      version: compiledGameRules.TIC_TAC_TOE_GAME_VERSION,
      apiVersion: 1,
      players: { min: 2, max: 2 },
      capabilities: ['invites', 'replay', 'resync', 'score'],
      distribution: 'official',
      source: 'built-in',
      enabled: true,
    },
    compiledGameRules.ticTacToeRules,
  );
  registry.registerOfficial(
    {
      gameId: compiledGameRules.REVERSI_GAME_ID,
      displayName: 'Reversi',
      version: compiledGameRules.REVERSI_GAME_VERSION,
      apiVersion: 1,
      players: { min: 2, max: 2 },
      capabilities: ['invites', 'replay', 'resync', 'score'],
      distribution: 'official',
      source: 'built-in',
      enabled: true,
    },
    compiledGameRules.reversiRules,
  );
  return registry;
}

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
  GameRegistry: GameRegistryConstructor = GameRegistry,
  GameSessionManager: GameSessionManagerConstructor = GameSessionManager,
  GameStorage: GameStorageConstructor = GameStorage,
  compiledGameRules,
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
  const gameRegistry = createOfficialGameRegistry(compiledGameRules);
  const gameLimits = limitsFromEnvironment(environment);
  const gameStorage = persistence.database
    ? new GameStorageConstructor(persistence.database)
    : null;
  const gameSessions = gameStorage
    ? new GameSessionManagerConstructor({
        registry: gameRegistry,
        storage: gameStorage,
        limits: gameLimits,
      })
    : null;
  const xmpp = new XmppAdapter(
    app.isPackaged,
    persistence,
    loadMucPolicies(environment),
    fileTransfers,
    outgoingFileTransfers,
    stickerStorageProvider,
    stickerStorageConfiguration,
    hasMucOperatorConfiguration(environment),
    { manager: gameSessions, registry: gameRegistry, limits: gameLimits },
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
    gameRegistry,
    gameStorage,
    gameSessions,
    reconciliation,
  };
}

module.exports = {
  createRuntime,
  hasMucOperatorConfiguration,
  loadMucPolicies,
  startRuntimeReconciliation,
  createOfficialGameRegistry,
};
