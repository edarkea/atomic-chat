const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { xml } = require('@xmpp/client');
const { PersistenceStore } = require('../electron/storage.cjs');
const {
  REACTIONS_NS,
  SID_NS,
  codePointSlice,
  reactionEmojis,
  replyBody,
  stanzaIds,
} = require('../electron/xmpp-message-features.cjs');

test('reactions are parsed without requiring a textual body and are deduplicated', () => {
  const stanza = xml('message', {}, xml('reactions', { xmlns: REACTIONS_NS, id: 'origin-1' },
    xml('reaction', {}, '👍'), xml('reaction', {}, '👍'), xml('reaction', {}, '❤️')));
  assert.deepEqual(reactionEmojis(stanza), ['👍', '❤️']);
});

test('fallback reply ranges use Unicode code points without splitting surrogate pairs', () => {
  const reference = { authorJid: 'bob@example.invalid', quote: '😀 hola', stanzaIds: [] };
  const composed = replyBody('respuesta', reference);
  assert.equal(composed.body, '> bob@example.invalid: 😀 hola\nrespuesta');
  assert.equal(codePointSlice(composed.body, 0, composed.fallback.end), '> bob@example.invalid: 😀 hola');
});

test('stanza-id preserves id and by for room-scoped references', () => {
  const stanza = xml('message', {},
    xml('stanza-id', { xmlns: SID_NS, id: 'room-1', by: 'room@example.invalid' }),
    xml('stanza-id', { xmlns: SID_NS, id: 'other-1', by: 'gateway.example.invalid' }));
  assert.deepEqual(stanzaIds(stanza), [
    { id: 'room-1', by: 'room@example.invalid' },
    { id: 'other-1', by: 'gateway.example.invalid' },
  ]);
});

test('reaction persistence is account-isolated and empty sets remove an actor', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-reactions-'));
  const store = new PersistenceStore(directory);
  for (const accountId of ['one@example.invalid', 'two@example.invalid'])
    store.upsertAccount({ accountId, host: 'example.invalid', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  store.saveMessage({ id: 'one-msg', accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', clientMessageId: 'one-client', senderJid: 'bob@example.invalid', messageId: 'wire-1', originId: 'origin-1', stanzaIds: [], body: { kind: 'text', text: 'hola' }, status: 'sent', createdAt: new Date().toISOString() });
  store.saveReaction({ accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', source: 'direct', target: { originId: 'origin-1', stanzaIds: [], authorJid: 'bob@example.invalid' }, reactions: [{ emoji: '👍', actors: [{ id: 'bob@example.invalid', label: 'bob', identifiable: true }] }], updatedAt: new Date().toISOString() });
  assert.equal(store.listMessages('one@example.invalid', 'bob@example.invalid')[0].reactions[0].emoji, '👍');
  assert.equal(store.listMessages('two@example.invalid', 'bob@example.invalid').length, 0);
  store.saveReaction({ accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', source: 'direct', target: { originId: 'origin-1', stanzaIds: [], authorJid: 'bob@example.invalid' }, reactions: [], updatedAt: new Date().toISOString() });
  assert.equal(store.listMessages('one@example.invalid', 'bob@example.invalid')[0].reactions, undefined);
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
