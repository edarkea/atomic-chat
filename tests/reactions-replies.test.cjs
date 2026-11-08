const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { xml } = require('@xmpp/client');
const { PersistenceStore } = require('../electron/storage.cjs');
const {
  REACTIONS_NS,
  SID_NS,
  codePointSlice,
  reactionTarget,
  reactionEmojis,
  replyBody,
  stanzaIds,
  visibleBody,
} = require('../electron/xmpp-message-features.cjs');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

test('reactions are parsed without requiring a textual body and are deduplicated', () => {
  const stanza = xml('message', {}, xml('reactions', { xmlns: REACTIONS_NS, id: 'origin-1' },
    xml('reaction', {}, '👍'), xml('reaction', {}, '👍'), xml('reaction', {}, '❤️')));
  assert.deepEqual(reactionEmojis(stanza), ['👍', '❤️']);
});

test('reaction stanza identifiers are not mistaken for the target identifiers', () => {
  const stanza = xml('message', { id: 'reaction-event' },
    xml('origin-id', { xmlns: SID_NS, id: 'reaction-origin' }),
    xml('stanza-id', { xmlns: SID_NS, id: 'reaction-stanza', by: 'example.invalid' }),
    xml('reactions', { xmlns: REACTIONS_NS, id: 'target-origin' }, xml('reaction', {}, '👍')));
  assert.deepEqual(reactionTarget(stanza, 'bob@example.invalid'), {
    messageId: 'target-origin', stanzaIds: [], authorJid: 'bob@example.invalid',
  });
});

test('valid reply fallback is removed from visible body exactly once', () => {
  const reference = { authorJid: 'bob@example.invalid', quote: '😀 hola', stanzaIds: [] };
  const composed = replyBody('respuesta', reference);
  const stanza = xml('message', {},
    xml('body', {}, composed.body),
    xml('reply', { xmlns: 'urn:xmpp:reply:0', id: 'origin-1', to: 'bob@example.invalid' }),
    xml('fallback', { xmlns: 'urn:xmpp:fallback:0', for: 'urn:xmpp:reply:0' },
      xml('body', { start: String(composed.fallback.start), end: String(composed.fallback.end) })));
  assert.equal(visibleBody(stanza), 'respuesta');
});

test('adapter preserves reaction sequence, actors, and selective empty removal', () => {
  const events = [];
  const adapter = Object.create(XmppAdapter.prototype);
  adapter.reactionStates = new Map();
  adapter.reactionEventKeys = new Set();
  adapter.mucRooms = new Map();
  adapter.emit = (event) => events.push(event);
  const target = { messageId: 'target-1', stanzaIds: [], authorJid: 'bob@example.invalid' };
  const apply = (actorJid, emojis, eventId) => adapter.applyReaction({
    accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', target,
    emojis, actorJid, source: 'direct', eventId,
  });
  apply('bob@example.invalid', ['👍'], 'event-1');
  apply('alice@example.invalid', ['❤️'], 'event-2');
  apply('bob@example.invalid', [], 'event-3');
  assert.deepEqual(events.at(-1).payload.reactions.map((item) => item.emoji), ['❤️']);
  assert.equal(events.at(-1).payload.reactions[0].actors[0].id, 'alice@example.invalid');
  apply('bob@example.invalid', ['👍'], 'event-4');
  assert.deepEqual(events.at(-1).payload.reactions.map((item) => item.emoji).sort(), ['❤️', '👍']);
});

test('latest reaction rejection rolls back only the pending actor update', () => {
  const events = [];
  const adapter = Object.create(XmppAdapter.prototype);
  adapter.reactionStates = new Map();
  adapter.reactionEventKeys = new Set();
  adapter.pendingReactions = new Map();
  adapter.latestReactionOperation = new Map();
  adapter.mucRooms = new Map();
  adapter.emit = (event) => events.push(event);
  const target = { messageId: 'target-rollback', stanzaIds: [], authorJid: 'bob@example.invalid' };
  adapter.applyReaction({ accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', target, emojis: ['👍'], actorJid: 'one@example.invalid', source: 'direct', eventId: 'base' });
  adapter.trackReaction('op-1', { accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', target, targetMessageId: 'target-rollback', actorJid: 'one@example.invalid', source: 'direct' });
  adapter.applyReaction({ accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', target, emojis: ['❤️'], actorJid: 'one@example.invalid', source: 'direct', eventId: 'optimistic' });
  adapter.rejectReaction('op-1');
  const rollback = events.filter((event) => event.type === 'reaction.changed').at(-1);
  assert.deepEqual(rollback.payload.reactions.map((item) => item.emoji), ['👍']);
});

test('reply presentation and contextual actions stay outside the bubble flow', () => {
  const template = readFileSync(path.join(__dirname, '..', 'src', 'app', 'message-item.component.html'), 'utf8');
  const styles = readFileSync(path.join(__dirname, '..', 'src', 'app', 'message-item.component.scss'), 'utf8');
  const conversation = readFileSync(path.join(__dirname, '..', 'src', 'app', 'conversation-view.component.ts'), 'utf8');
  const muc = readFileSync(path.join(__dirname, '..', 'src', 'app', 'muc-view.component.ts'), 'utf8');
  assert.ok(template.indexOf('message-reply-quote') < template.indexOf('class="message-body"'));
  assert.equal(template.includes('reply.authorJid'), false);
  assert.match(conversation, /protected replyAuthor\(/);
  assert.match(conversation, /protected actionTargetId\(message: Message\)/);
  assert.match(muc, /protected actionTargetId\(message: RoomMessage\)/);
  assert.match(conversation, /protected readonly reactionActorLabel = \(actor: ReactionActor\)/);
  assert.match(muc, /protected readonly reactionActorLabel = \(actor: ReactionActor\)/);
  assert.match(template, /reactionTooltipText\(reaction\)/);
  assert.equal(template.includes('<details'), false);
  assert.match(styles, /\.message-reaction-tooltip\s*\{[^}]*display:\s*flex/);
  assert.match(styles, /\.message-reaction-tooltip\s*\{[^}]*align-items:\s*center/);
  assert.match(styles, /\.message-reaction-tooltip\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(styles, /\.message-reaction-tooltip\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(styles, /\.message-actions\s*\{[^}]*position:\s*absolute/);
  assert.match(template, /message-action--reaction/);
  assert.match(template, /message-action--menu/);
  assert.match(styles, /\.message-actions\s*\{[^}]*inset:\s*0/);
  assert.match(styles, /:host\s*\{[^}]*display:\s*block[^}]*width:\s*100%/);
  assert.match(styles, /\.message:hover \.message-actions,[\s\S]*?opacity:\s*1/);
  assert.match(styles, /:host:hover \.message-action--reaction/);
  assert.match(styles, /\.message:hover \.message-action--menu/);
  assert.match(styles, /\.message-actions::before\s*\{[^}]*pointer-events:\s*auto[^}]*width:\s*6px/);
  assert.match(styles, /\.message\.outgoing \.message-actions::before\s*\{[^}]*right:\s*100%/);
  assert.match(styles, /\.message-action--reaction\s*\{[^}]*left:\s*calc\(100% \+ 6px\)[^}]*top:\s*10px/);
  assert.match(styles, /\.message\.outgoing \.message-action--reaction\s*\{[^}]*right:\s*calc\(100% \+ 6px\)/);
  assert.match(styles, /\.message-action--menu\s*\{[^}]*right:\s*6px[^}]*top:\s*6px/);
  assert.match(styles, /\.message-actions > \.message-action--reaction,[\s\S]*?height:\s*30px/);
  assert.match(styles, /\.message-actions > \.message-action--menu\s*\{[\s\S]*?border-radius:\s*var\(--atomic-radius-sm\)/);
  assert.doesNotMatch(styles, /\.message-actions\s*\{[^}]*background:/);
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
  store.saveMessage({ id: 'one-msg', accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', clientMessageId: 'one-client', senderJid: 'bob@example.invalid', messageId: 'wire-1', originId: 'origin-1', stanzaIds: [], replyTo: { messageId: 'wire-0', stanzaIds: [], authorJid: 'bob@example.invalid', quote: 'anterior' }, body: { kind: 'text', text: 'hola' }, status: 'sent', createdAt: new Date().toISOString() });
  store.saveMessage({ id: 'stanza-msg', accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', clientMessageId: 'stanza-client', senderJid: 'bob@example.invalid', stanzaIds: [{ id: 'stanza-1', by: 'server.example.invalid' }], body: { kind: 'text', text: 'stanza' }, status: 'sent', createdAt: new Date().toISOString() });
  store.saveReaction({ accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', source: 'direct', target: { originId: 'origin-1', stanzaIds: [], authorJid: 'bob@example.invalid' }, reactions: [{ emoji: '👍', actors: [{ id: 'bob@example.invalid', label: 'bob', identifiable: true }] }], updatedAt: new Date().toISOString() });
  assert.equal(store.listMessages('one@example.invalid', 'bob@example.invalid')[0].reactions[0].emoji, '👍');
  assert.equal(store.listMessages('two@example.invalid', 'bob@example.invalid').length, 0);
  assert.equal(store.getMessage('one@example.invalid', 'bob@example.invalid', 'stanza-1')?.id, 'stanza-msg');
  store.saveReaction({ accountId: 'one@example.invalid', conversationId: 'bob@example.invalid', source: 'direct', target: { originId: 'origin-1', stanzaIds: [], authorJid: 'bob@example.invalid' }, reactions: [], updatedAt: new Date().toISOString() });
  assert.equal(store.listMessages('one@example.invalid', 'bob@example.invalid')[0].reactions, undefined);
  const timeline = store.listTimelinePage('one@example.invalid', 'bob@example.invalid', 10, 'older', null);
  assert.equal(timeline.items[0].message.messageId, 'wire-1');
  assert.equal(timeline.items[0].message.originId, 'origin-1');
  assert.equal(timeline.items[0].message.replyTo.quote, 'anterior');
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
