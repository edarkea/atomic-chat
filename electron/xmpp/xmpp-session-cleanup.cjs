/**
 * @typedef {{sessions: Map<string, unknown>, rosters: Map<string, unknown>, remoteResources: Map<string, unknown>, pendingPresences: Map<string, unknown>, initialPresencePublished: Set<string>, publishedPresences: Map<string, unknown>, sessionDomains: Map<string, unknown>, sessionEndpoints: Map<string, unknown>, sessionJids: Map<string, unknown>, carbons: {clear: (accountId: string) => void}, stickerService?: {clear: (accountId: string) => void}, sessionGenerations: Map<string, number>}} SessionCleanupAdapter
 */

/** @param {SessionCleanupAdapter} adapter */
function createXmppSessionCleanup(adapter) {
  return {
    /** @param {string} accountId @returns {void} */
    clear(accountId) {
      adapter.sessions.delete(accountId);
      adapter.rosters.delete(accountId);
      adapter.remoteResources.delete(accountId);
      adapter.pendingPresences.delete(accountId);
      adapter.initialPresencePublished.delete(accountId);
      adapter.publishedPresences.delete(accountId);
      adapter.sessionDomains.delete(accountId);
      adapter.sessionEndpoints.delete(accountId);
      adapter.sessionJids.delete(accountId);
      adapter.carbons.clear(accountId);
      adapter.stickerService?.clear(accountId);
      adapter.sessionGenerations.set(
        accountId,
        (adapter.sessionGenerations.get(accountId) || 0) + 1,
      );
    },
  };
}

module.exports = { createXmppSessionCleanup };
