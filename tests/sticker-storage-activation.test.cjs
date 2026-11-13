const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activateStickerStorage,
  readStickerStorageConfiguration,
} = require('../electron/stickers/sticker-storage-activation.cjs');

test('E8.5-ALT-08 reports persistent HTTPS unavailable without complete authorized configuration', () => {
  const empty = readStickerStorageConfiguration({});
  assert.equal(empty.configured, false);
  assert.equal(empty.alternativeAvailable, false);
  assert.equal(empty.configurationError, 'UNSUPPORTED');
  const incomplete = readStickerStorageConfiguration({
    ATOMIC_STICKER_STORAGE_PROVIDER_ID: 'storage-1',
  });
  assert.equal(incomplete.configured, false);
  assert.equal(incomplete.configurationError, 'INVALID_INPUT');
  const activation = activateStickerStorage({
    environment: {
      ATOMIC_STICKER_STORAGE_PROVIDER_ID: 'storage-1',
      ATOMIC_STICKER_STORAGE_BASE_URL: 'https://storage.example.test',
      ATOMIC_STICKER_STORAGE_ORIGINS: 'https://storage.example.test',
    },
  });
  assert.equal(activation.provider, null);
  assert.equal(activation.configuration.alternativeAvailable, false);
});

test('E8.5-ALT-08 selects persistent HTTPS only through an injected provider factory', () => {
  const provider = { providerId: 'storage-1' };
  const activation = activateStickerStorage({
    environment: {
      ATOMIC_STICKER_STORAGE_PROVIDER_ID: 'storage-1',
      ATOMIC_STICKER_STORAGE_BASE_URL: 'https://storage.example.test',
      ATOMIC_STICKER_STORAGE_ORIGINS: 'https://storage.example.test',
    },
    providerFactory: (configuration) => {
      assert.deepEqual(configuration, {
        providerId: 'storage-1',
        baseUrl: 'https://storage.example.test',
        origins: ['https://storage.example.test'],
      });
      return provider;
    },
  });
  assert.equal(activation.provider, provider);
  assert.equal(activation.configuration.transportMode, 'PERSISTENT_HTTPS');
  assert.equal(activation.configuration.alternativeAvailable, true);
});
