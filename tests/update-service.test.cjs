const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateService } = require('../electron/update-service.cjs');

function fakeUpdater() {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {};
  updater.downloadUpdate = async () => {};
  updater.quitAndInstall = () => {};
  updater.setFeedURL = () => {};
  return updater;
}

function setup({ critical = false } = {}) {
  const updater = fakeUpdater();
  let quitCalled = false;
  updater.quitAndInstall = () => {
    quitCalled = true;
  };
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '1.0.0' },
    isPackaged: true,
    autoUpdaterFactory: () => updater,
    hasCriticalTransfers: () => critical,
    intervalMs: 60_000,
  });
  return { updater, service, wasInstalled: () => quitCalled };
}

test('updater transitions to up-to-date when no release is available', async () => {
  const { updater, service } = setup();
  updater.checkForUpdates = async () => updater.emit('update-not-available');

  const status = await service.check({ version: 1, requestId: 'check-1' });

  assert.equal(status.state, 'up-to-date');
  assert.equal(status.requestId, 'check-1');
  service.stop();
});

test('updater exposes available and downloaded states without auto-download', async () => {
  const { updater, service, wasInstalled } = setup();
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.1.0' });
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '1.1.0' });

  const available = await service.check({ version: 1, requestId: 'check-2' });
  assert.equal(available.state, 'available');
  assert.equal(updater.autoDownload, false);
  const downloaded = await service.download({ version: 1, requestId: 'download-1' });
  assert.equal(downloaded.state, 'downloaded');
  assert.equal(wasInstalled(), false);
  assert.equal(service.getStatus({ version: 1, requestId: 'retained' }).state, 'downloaded');
  await service.check({ version: 1, requestId: 'periodic' });
  assert.equal(service.getStatus({ version: 1, requestId: 'retained-after-check' }).state, 'downloaded');
  service.stop();
});

test('download failures are represented as a safe error state', async () => {
  const { updater, service } = setup();
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.1.0' });
  updater.downloadUpdate = async () => {
    throw new Error('network unavailable');
  };
  await service.check({ version: 1, requestId: 'check-3' });

  await assert.rejects(
    service.download({ version: 1, requestId: 'download-2' }),
    (error) => error.code === 'INTERNAL',
  );
  assert.equal(service.getStatus({ version: 1, requestId: 'status-1' }).state, 'error');
  service.stop();
});

test('installation is blocked while a critical transfer is active', async () => {
  const { updater, service, wasInstalled } = setup({ critical: true });
  updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.1.0' });
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '1.1.0' });
  await service.check({ version: 1, requestId: 'check-4' });
  await service.download({ version: 1, requestId: 'download-3' });

  await assert.rejects(
    service.install({ version: 1, requestId: 'install-1' }),
    (error) => error.code === 'CONFLICT',
  );
  assert.equal(service.getStatus({ version: 1, requestId: 'still-ready' }).state, 'downloaded');
  assert.equal(wasInstalled(), false);
  service.stop();
});

test('unpackaged applications do not load or invoke an updater', async () => {
  let factoryCalled = false;
  const service = createUpdateService({
    app: { isPackaged: false, getVersion: () => '0.0.0' },
    autoUpdaterFactory: () => {
      factoryCalled = true;
      return fakeUpdater();
    },
  });
  await assert.rejects(
    service.check({ version: 1, requestId: 'dev-check' }),
    (error) => error.code === 'UNSUPPORTED',
  );
  assert.equal(factoryCalled, false);
  service.stop();
});

test('uses the Atomic Chat package version instead of the Electron runtime version', () => {
  const service = createUpdateService({
    app: { isPackaged: false, getVersion: () => '39.8.10' },
    applicationVersion: '0.0.0',
  });

  assert.equal(
    service.getStatus({ version: 1, requestId: 'version-check' }).currentVersion,
    '0.0.0',
  );
  service.stop();
});
