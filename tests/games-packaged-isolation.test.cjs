const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const {
  resolveApplicationDataPath,
  validatePackagedSmokeRoot,
} = require('../electron/security/packaged-smoke-isolation.cjs');

function createTemporaryDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function fingerprintDatabase(databasePath) {
  const directory = path.dirname(databasePath);
  const baseName = path.basename(databasePath);
  return fs
    .readdirSync(directory)
    .filter((name) => name === baseName || name.startsWith(`${baseName}-`))
    .sort()
    .map((name) => ({ name, hash: hashFile(path.join(directory, name)) }));
}

function expectIsolationFailure(value, options) {
  assert.throws(() => validatePackagedSmokeRoot(value, options), /Packaged smoke/);
}

test('packaged smoke resolves only a fresh writable child of the temporary root', () => {
  const temporaryRoot = createTemporaryDirectory('atomic-chat-isolation-parent-');
  const smokeRoot = fs.mkdtempSync(path.join(temporaryRoot, 'smoke-'));
  const sentinelPath = path.join(temporaryRoot, 'sentinel.sqlite');
  const sentinelDatabase = new Database(sentinelPath);
  sentinelDatabase.exec(
    "CREATE TABLE sentinel (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO sentinel VALUES (1, 'untouched');",
  );
  sentinelDatabase.close();
  const sentinelFingerprint = fingerprintDatabase(sentinelPath);

  try {
    const resolved = validatePackagedSmokeRoot(smokeRoot, { temporaryRoot });
    assert.equal(resolved.applicationDataPath, path.join(smokeRoot, 'AtomicChat-Data'));
    assert.equal(fs.existsSync(resolved.applicationDataPath), false);
    assert.deepEqual(fingerprintDatabase(sentinelPath), sentinelFingerprint);

    const productionPath = resolveApplicationDataPath({
      isPackaged: true,
      environment: {},
      appDataPath: path.join(temporaryRoot, 'normal-app-data'),
      portableExecutableDirectory: '',
      temporaryRoot,
    });
    assert.equal(productionPath, path.join(temporaryRoot, 'normal-app-data', 'AtomicChat-Data'));
    assert.equal(fs.existsSync(productionPath), false);
    assert.deepEqual(fingerprintDatabase(sentinelPath), sentinelFingerprint);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('invalid, incomplete and redirected smoke roots fail closed', () => {
  const temporaryRoot = createTemporaryDirectory('atomic-chat-isolation-negative-');
  const validRoot = fs.mkdtempSync(path.join(temporaryRoot, 'valid-'));
  const outsideRoot = createTemporaryDirectory('atomic-chat-isolation-outside-');
  const filePath = path.join(temporaryRoot, 'not-a-directory');
  fs.writeFileSync(filePath, 'synthetic file');
  const existingDataPath = path.join(validRoot, 'AtomicChat-Data');
  fs.mkdirSync(existingDataPath);
  const missingRoot = path.join(temporaryRoot, 'missing');

  try {
    for (const value of [undefined, '', 'relative-smoke-root', missingRoot, filePath, outsideRoot])
      expectIsolationFailure(value, { temporaryRoot });
    expectIsolationFailure(validRoot, { temporaryRoot });

    for (const environment of [
      { ATOMIC_CHAT_PACKAGED_SMOKE: '1' },
      { ATOMIC_CHAT_SMOKE_DATA_ROOT: validRoot },
      { ATOMIC_CHAT_PACKAGED_SMOKE: 'true', ATOMIC_CHAT_SMOKE_DATA_ROOT: validRoot },
    ]) {
      assert.throws(
        () =>
          resolveApplicationDataPath({
            isPackaged: true,
            environment,
            appDataPath: path.join(temporaryRoot, 'normal-app-data'),
            temporaryRoot,
          }),
        /Packaged smoke/,
      );
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('symlinked smoke roots are rejected without following the redirect', (t) => {
  const temporaryRoot = createTemporaryDirectory('atomic-chat-isolation-symlink-');
  const realRoot = fs.mkdtempSync(path.join(temporaryRoot, 'real-'));
  const linkPath = path.join(temporaryRoot, 'link-');
  const childRedirectRoot = fs.mkdtempSync(path.join(temporaryRoot, 'child-'));
  const childTargetRoot = fs.mkdtempSync(path.join(temporaryRoot, 'child-target-'));
  const childLinkPath = path.join(childRedirectRoot, 'AtomicChat-Data');
  try {
    try {
      fs.symlinkSync(realRoot, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      fs.symlinkSync(
        childTargetRoot,
        childLinkPath,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      t.skip(`symlink/junction creation unavailable: ${error.code || error.message}`);
      return;
    }
    expectIsolationFailure(linkPath, { temporaryRoot });
    expectIsolationFailure(childRedirectRoot, { temporaryRoot });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('unwritable smoke roots fail before application data resolution', () => {
  const temporaryRoot = createTemporaryDirectory('atomic-chat-isolation-access-');
  const smokeRoot = fs.mkdtempSync(path.join(temporaryRoot, 'smoke-'));
  const inaccessibleFs = {
    ...fs,
    accessSync() {
      const error = new Error('synthetic access denied');
      error.code = 'EACCES';
      throw error;
    },
  };
  try {
    expectIsolationFailure(smokeRoot, { fsModule: inaccessibleFs, temporaryRoot });
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
