const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplicationAttention } = require('../electron/application-attention.cjs');

function harness(focused = false) {
  const calls = [];
  const window = {
    destroyed: false,
    focused,
    isDestroyed() { return this.destroyed; },
    isFocused() { return this.focused; },
    flashFrame(value) { calls.push(['flash', value]); },
  };
  let bounce = 0;
  const app = {
    dock: {
      bounce: () => { calls.push(['bounce']); return ++bounce; },
      cancelBounce: (id) => calls.push(['cancel', id]),
    },
  };
  return {
    calls,
    window,
    attention: createApplicationAttention({ BrowserWindow: { getAllWindows: () => [window] }, app }),
  };
}

test('does not request native attention while the window is focused', () => {
  const fixture = harness(true);
  assert.equal(fixture.attention.request('a@example.invalid'), false);
  assert.deepEqual(fixture.calls, []);
});

test('deduplicates native attention per account and clears it without changing unread state', () => {
  const fixture = harness(false);
  assert.equal(fixture.attention.request('a@example.invalid'), true);
  assert.equal(fixture.attention.request('a@example.invalid'), false);
  fixture.attention.clear('a@example.invalid');
  assert.deepEqual(fixture.calls, [
    ['flash', true],
    ['bounce'],
    ['flash', false],
    ['cancel', 1],
  ]);
});

test('focus acknowledgement stops all pending attention requests', () => {
  const fixture = harness(false);
  fixture.attention.request('a@example.invalid');
  fixture.attention.request('b@example.invalid');
  fixture.attention.acknowledge();
  assert.deepEqual(fixture.calls, [
    ['flash', true],
    ['bounce'],
    ['flash', true],
    ['bounce'],
    ['flash', false],
    ['cancel', 2],
  ]);
});
