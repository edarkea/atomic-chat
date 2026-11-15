const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { XmppProfileCache, avatarHash } = require('../electron/xmpp/xmpp-profile-cache.cjs');
const { XmppProfileStore } = require('../electron/xmpp/xmpp-profile-store.cjs');

const ACCOUNT = 'operator@example.invalid';
const CONTACT = 'contact@example.invalid';
const IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const decoder = {
  createFromBuffer: () => ({
    isEmpty: () => false,
    getSize: () => ({ width: 1, height: 1 }),
  }),
};

async function temporaryDirectory() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-profile-cache-'));
}

test('profile cache rehydrates validated profile bytes without an external URL', async () => {
  const directory = await temporaryDirectory();
  try {
    const cache = new XmppProfileCache(directory, { nativeImage: decoder });
    await cache.put(
      ACCOUNT,
      CONTACT,
      {
        accountId: ACCOUNT,
        jid: CONTACT,
        source: 'vcard-temp',
        displayName: 'Contact name',
        fetchedAt: new Date().toISOString(),
      },
      IMAGE,
    );

    const value = await cache.get(ACCOUNT, CONTACT);
    assert.equal(value.profile.displayName, 'Contact name');
    assert.equal(value.avatarHash, avatarHash(IMAGE));
    assert.deepEqual(value.data, IMAGE);
    assert.equal(Object.hasOwn(value.profile, 'image'), false);
    assert.equal(Object.hasOwn(value.profile, 'base64'), false);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('profile cache invalidates only when the advertised avatar hash changes', async () => {
  const directory = await temporaryDirectory();
  try {
    const cache = new XmppProfileCache(directory, { nativeImage: decoder });
    await cache.put(ACCOUNT, CONTACT, { accountId: ACCOUNT, jid: CONTACT }, IMAGE);
    const same = await cache.invalidateIfChanged(ACCOUNT, CONTACT, avatarHash(IMAGE));
    assert.equal(same, false);
    assert.ok(await cache.get(ACCOUNT, CONTACT));

    const changed = await cache.invalidateIfChanged(ACCOUNT, CONTACT, 'a'.repeat(40));
    assert.equal(changed, true);
    assert.equal(await cache.get(ACCOUNT, CONTACT), undefined);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('profile data does not expire by time', async () => {
  const directory = await temporaryDirectory();
  try {
    const store = new XmppProfileStore(directory, { nativeImage: decoder });
    await store.put(ACCOUNT, CONTACT, { accountId: ACCOUNT, jid: CONTACT }, IMAGE);
    const indexPath = path.join(directory, 'index.json');
    const index = JSON.parse(await fsp.readFile(indexPath, 'utf8'));
    for (const entry of Object.values(index.entries)) entry.cachedAt = 1;
    await fsp.writeFile(indexPath, JSON.stringify(index));
    const value = await new XmppProfileStore(directory, { nativeImage: decoder }).get(
      ACCOUNT,
      CONTACT,
    );
    assert.deepEqual(value.data, IMAGE);
    assert.equal(value.avatarHash, avatarHash(IMAGE));
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});
