const test = require('node:test');
const assert = require('node:assert/strict');
const { registerUserProfileHandlers } = require('../electron/ipc/ipc-user-profile-handlers.cjs');

function fixture() {
  const handlers = new Map();
  let authorized = true;
  let selectedAvatar = 'C:\\avatar.png';
  const runtime = {
    xmpp: {
      getUserProfile: async () => ({
        accountId: 'operator@example.invalid',
        jid: 'contact@example.invalid',
        source: 'vcard-temp',
        displayName: 'Remote',
        image: {
          referenceId: 'opaque-reference',
          mimeType: 'image/png',
          sizeBytes: '12',
          width: 1,
          height: 1,
          expiresAt: '2026-11-14T00:05:00.000Z',
        },
        fetchedAt: '2026-11-14T00:00:00.000Z',
      }),
      updateUserProfile: async (_senderId, accountId, profile) => ({
        accountId,
        jid: accountId,
        source: 'vcard-temp',
        ...profile,
        fetchedAt: '2026-11-14T00:00:00.000Z',
      }),
      updateUserProfileAvatar: async (_senderId, accountId) => ({
        accountId,
        jid: accountId,
        source: 'vcard-temp',
        displayName: 'Remote',
        fetchedAt: '2026-11-14T00:00:00.000Z',
      }),
      clearUserProfileAvatar: async (_senderId, accountId) => ({
        accountId,
        jid: accountId,
        source: 'vcard-temp',
        displayName: 'Remote',
        fetchedAt: '2026-11-14T00:00:00.000Z',
      }),
      openUserProfileImage: async () => ({
        referenceId: 'opaque-reference',
        streamId: 'opaque-stream',
        expiresAt: '2026-11-14T00:05:00.000Z',
        chunkSize: 65536,
      }),
      readUserProfileImage: async () => ({
        referenceId: 'opaque-reference',
        streamId: 'opaque-stream',
        sequence: 0,
        bytes: new Uint8Array([1, 2]).buffer,
        done: true,
      }),
      closeUserProfileImage: async () => undefined,
      revokeUserProfileImage: async () => undefined,
    },
  };
  registerUserProfileHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => undefined,
    getRuntime: () => runtime,
    historySecurity: { authorize: () => authorized },
    selectAvatarSource: async () => selectedAvatar,
    helpers: {
      validVersion: (input) => input?.version === 1,
      requestId: (_event, input) => input?.requestId || 'generated-request',
    },
  });
  return {
    handlers,
    runtime,
    setAuthorized: (value) => (authorized = value),
    setAvatarSource: (value) => (selectedAvatar = value),
  };
}

const input = {
  version: 1,
  requestId: 'profile-request-1',
  accountId: 'operator@example.invalid',
  jid: 'contact@example.invalid',
};

test('profile IPC preserves the typed Result and never adds image data to the DTO', async () => {
  const value = fixture();
  const result = await value.handlers.get('userProfiles.get')({ sender: { id: 7 } }, input);

  assert.equal(result.ok, true);
  assert.equal(result.requestId, input.requestId);
  assert.equal(result.value.image.referenceId, 'opaque-reference');
  assert.equal(Object.hasOwn(result.value.image, 'data'), false);
  assert.equal(Object.hasOwn(result.value.image, 'base64'), false);
});

test('profile IPC rejects unauthorized windows and malformed bare JIDs with typed errors', async () => {
  const value = fixture();
  value.setAuthorized(false);
  assert.equal(
    (await value.handlers.get('userProfiles.get')({ sender: { id: 7 } }, input)).error.code,
    'UNAUTHORIZED',
  );

  value.setAuthorized(true);
  const invalid = await value.handlers.get('userProfiles.get')(
    { sender: { id: 7 } },
    { ...input, jid: 'contact@example.invalid/device' },
  );
  assert.equal(invalid.error.code, 'INVALID_JID');

  const invalidMode = await value.handlers.get('userProfiles.get')(
    { sender: { id: 7 } },
    { ...input, mode: 'network' },
  );
  assert.equal(invalidMode.error.code, 'INVALID_INPUT');
});

test('profile IPC updates only the authenticated account profile', async () => {
  const value = fixture();
  const result = await value.handlers.get('userProfiles.update')(
    { sender: { id: 7 } },
    {
      version: 1,
      requestId: 'profile-update-1',
      accountId: input.accountId,
      profile: {
        displayName: 'Updated',
        middleName: 'Carlos',
        company: 'Atomic Chat',
        jobTitle: 'Product Engineer',
        phone: '+593 2 000 0000',
        birthday: '1990-11-15',
        website: 'https://atomic.example.invalid/profile',
        nickname: 'Atomic',
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.accountId, input.accountId);
  assert.equal(result.value.displayName, 'Updated');
  assert.equal(result.value.middleName, 'Carlos');
  assert.equal(result.value.company, 'Atomic Chat');
  assert.equal(result.value.jobTitle, 'Product Engineer');
  assert.equal(result.value.phone, '+593 2 000 0000');
  assert.equal(result.value.birthday, '1990-11-15');
  assert.equal(result.value.website, 'https://atomic.example.invalid/profile');
});

test('profile image IPC keeps stream reads behind the same account and reference contract', async () => {
  const value = fixture();
  const opened = await value.handlers.get('userProfiles.image.open')(
    { sender: { id: 7 } },
    {
      version: 1,
      requestId: 'image-open-1',
      accountId: input.accountId,
      referenceId: 'opaque-reference',
    },
  );
  assert.equal(opened.ok, true);
  assert.equal(opened.value.streamId, 'opaque-stream');
  const read = await value.handlers.get('userProfiles.image.read')(
    { sender: { id: 7 } },
    {
      version: 1,
      requestId: 'image-read-1',
      accountId: input.accountId,
      referenceId: 'opaque-reference',
      streamId: 'opaque-stream',
      sequence: 0,
    },
  );
  assert.equal(read.ok, true);
  assert.deepEqual(Array.from(new Uint8Array(read.value.bytes)), [1, 2]);
});

test('avatar IPC delegates a native file selection without accepting renderer bytes', async () => {
  const value = fixture();
  const result = await value.handlers.get('userProfiles.avatar.update')(
    { sender: { id: 7 } },
    { version: 1, requestId: 'avatar-update-1', accountId: input.accountId },
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.accountId, input.accountId);
});

test('avatar IPC returns a typed cancellation when the native picker is cancelled', async () => {
  const value = fixture();
  value.setAvatarSource(null);
  const result = await value.handlers.get('userProfiles.avatar.update')(
    { sender: { id: 7 } },
    { version: 1, requestId: 'avatar-cancel-1', accountId: input.accountId },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value, null);
});

test('avatar IPC clears through the XMPP adapter', async () => {
  const value = fixture();
  const clear = await value.handlers.get('userProfiles.avatar.clear')(
    { sender: { id: 7 } },
    { version: 1, requestId: 'avatar-clear-1', accountId: input.accountId },
  );
  assert.equal(clear.ok, true);
  assert.equal(clear.value.accountId, input.accountId);
});
