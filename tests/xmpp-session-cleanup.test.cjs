const test = require('node:test');
const assert = require('node:assert/strict');
const { createXmppSessionCleanup } = require('../electron/xmpp/xmpp-session-cleanup.cjs');

test('session cleanup clears account-scoped runtime state and advances generation', () => {
  const cleared = [];
  const accountId = 'alice@example.invalid';
  const adapter = {
    sessions: new Map([[accountId, {}]]),
    rosters: new Map([[accountId, new Map()]]),
    remoteResources: new Map([[accountId, new Map()]]),
    pendingPresences: new Map([[accountId, new Map()]]),
    initialPresencePublished: new Set([accountId]),
    publishedPresences: new Map([[accountId, {}]]),
    sessionDomains: new Map([[accountId, 'example.invalid']]),
    sessionEndpoints: new Map([[accountId, {}]]),
    sessionJids: new Map([[accountId, 'alice@example.invalid/resource']]),
    carbons: { clear: (value) => cleared.push(['carbons', value]) },
    stickerService: { clear: (value) => cleared.push(['stickers', value]) },
    sessionGenerations: new Map([[accountId, 4]]),
  };

  createXmppSessionCleanup(adapter).clear(accountId);

  assert.equal(adapter.sessions.has(accountId), false);
  assert.equal(adapter.rosters.has(accountId), false);
  assert.equal(adapter.remoteResources.has(accountId), false);
  assert.equal(adapter.pendingPresences.has(accountId), false);
  assert.equal(adapter.initialPresencePublished.has(accountId), false);
  assert.equal(adapter.publishedPresences.has(accountId), false);
  assert.equal(adapter.sessionDomains.has(accountId), false);
  assert.equal(adapter.sessionEndpoints.has(accountId), false);
  assert.equal(adapter.sessionJids.has(accountId), false);
  assert.deepEqual(cleared, [
    ['carbons', accountId],
    ['stickers', accountId],
  ]);
  assert.equal(adapter.sessionGenerations.get(accountId), 5);
});
