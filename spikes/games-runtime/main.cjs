const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  protocol,
  session,
} = require('electron');

const ROOT = __dirname;
const HOST_FILE = path.join(ROOT, 'host.html');
const GAME_FILE = path.join(ROOT, 'game.html');
const HOST_PRELOAD = path.join(ROOT, 'host-preload.cjs');
const GAME_PRELOAD = path.join(ROOT, 'game-preload.cjs');
const mode = process.argv.includes('--mode=iframe') ? 'iframe' : 'view';
const jsonOutput = process.argv.includes('--json');
const token = crypto.randomBytes(24).toString('hex');
const gameUrl = 'atomic-game://fixture/game.html';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'atomic-game',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

const allowedGameKinds = new Set([
  'game-ready',
  'game-valid-message',
  'network-result',
  'popup-result',
  'permission-result',
  'download-result',
]);

const result = {
  mode,
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  startedAt: new Date().toISOString(),
  messages: [],
  consoleMessages: [],
  rejectedMessages: [],
  metrics: {},
  limitations: [
    'RSS and app.getAppMetrics() values are environment-dependent.',
    'The spike proves policy behavior in this local fixture, not a complete security guarantee.',
    'No XMPP, credentials, production IPC or package installation is used.',
  ],
};

let hostWindow;
let gameView;
let baselineCaptured = false;
let runtimeReady = false;
let finishing = false;
let finishTimer;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureMetrics() {
  return app.getAppMetrics().map((metric) => ({
    type: metric.type,
    pid: metric.pid,
    memory: {
      workingSetSize: metric.memory?.workingSetSize,
      peakWorkingSetSize: metric.memory?.peakWorkingSetSize,
      privateBytes: metric.memory?.privateBytes,
    },
    cpu: metric.cpu,
  }));
}

function rejectMessage(source, reason) {
  result.rejectedMessages.push({ source, reason });
}

function validateGameMessage(source, value) {
  if (!isRecord(value)) {
    rejectMessage(source, 'not-an-object');
    return undefined;
  }
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    rejectMessage(source, 'not-serializable');
    return undefined;
  }
  if (serialized.length > 8192) {
    rejectMessage(source, 'payload-too-large');
    return undefined;
  }
  if (value.token !== token) {
    rejectMessage(source, 'invalid-token');
    return undefined;
  }
  if (typeof value.kind !== 'string' || !allowedGameKinds.has(value.kind)) {
    rejectMessage(source, 'unknown-kind');
    return undefined;
  }
  return value;
}

function acceptGameMessage(source, value, sender) {
  const message = validateGameMessage(source, value);
  if (!message) return;
  result.messages.push({ source, kind: message.kind });
  if (message.kind === 'game-ready') {
    runtimeReady = true;
    result.gameChecks = message.checks;
    result.metrics.runtimeReady = captureMetrics();
  }
  if (message.kind === 'network-result') result.networkResult = message.result;
  if (message.kind === 'popup-result') result.popupBlocked = message.blocked === true;
  if (message.kind === 'permission-result') result.permissionResult = message.result;
  if (message.kind === 'download-result') result.downloadAttempt = message.result;
  if (sender && typeof sender.send === 'function')
    sender.send('spike-game-ack', { kind: 'host-ack', token });
}

function installNetworkPolicy(targetSession) {
  targetSession.webRequest.onBeforeRequest((details, callback) => {
    const blocked = /^(https?|wss?):/i.test(details.url);
    callback({ cancel: blocked });
  });
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  targetSession.on('will-download', (event) => {
    result.downloadBlocked = true;
    event.preventDefault();
  });
}

function isAllowedGameUrl(value) {
  return value === gameUrl || value.startsWith(`${gameUrl}?`) || value.startsWith(`${gameUrl}#`);
}

function installGameProtocol(targetSession) {
  targetSession.protocol.handle('atomic-game', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'fixture') return new Response('Not found', { status: 404 });
    if (url.pathname === '/game.html')
      return new Response(fs.readFileSync(GAME_FILE), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    if (url.pathname === '/game-renderer.js')
      return new Response(fs.readFileSync(path.join(ROOT, 'game-renderer.js')), {
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
      });
    return new Response('Not found', { status: 404 });
  });
}

function configureGameView(view) {
  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedGameUrl(url)) {
      event.preventDefault();
      rejectMessage('webcontents', 'navigation-blocked');
    }
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedGameUrl(url)) {
      event.preventDefault();
      rejectMessage('webcontents', 'redirect-blocked');
    }
  });
  contents.on('render-process-gone', (_event, details) => {
    result.renderProcessGone = details.reason;
  });
  contents.on('destroyed', () => {
    result.gameWebContentsDestroyed = true;
  });
}

function createGameView() {
  const partition = `games-spike-${crypto.randomUUID()}`;
  const isolatedSession = session.fromPartition(partition);
  installNetworkPolicy(isolatedSession);
  installGameProtocol(isolatedSession);
  gameView = new WebContentsView({
    webPreferences: {
      preload: GAME_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition,
    },
  });
  configureGameView(gameView);
  hostWindow.contentView.addChildView(gameView);
  gameView.setBounds({ x: 24, y: 82, width: 720, height: 500 });
  void gameView.webContents.loadURL(`${gameUrl}?mode=view&token=${encodeURIComponent(token)}`);
}

async function destroyRuntime() {
  if (mode === 'view' && gameView) {
    const contents = gameView.webContents;
    hostWindow.contentView.removeChildView(gameView);
    gameView = undefined;
    if (!contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
  } else if (hostWindow && !hostWindow.webContents.isDestroyed()) {
    await hostWindow.webContents.executeJavaScript(
      "document.querySelector('#game')?.remove(); void 0;",
      true,
    );
  }
}

async function finish() {
  if (finishing) return;
  finishing = true;
  clearTimeout(finishTimer);
  await destroyRuntime();
  await new Promise((resolve) => setTimeout(resolve, 300));
  result.metrics.afterDestroy = captureMetrics();
  result.hostStorage = await hostWindow.webContents.executeJavaScript(
    "localStorage.getItem('spike-host-only')",
    true,
  );
  result.finishedAt = new Date().toISOString();
  result.runtimeReady = runtimeReady;
  result.resourceReleaseObserved =
    mode === 'view' ? result.gameWebContentsDestroyed === true : true;
  ipcMain.removeAllListeners('spike.host-message');
  ipcMain.removeAllListeners('spike.game-message');
  if (jsonOutput) process.stdout.write(`${JSON.stringify(result)}\n`);
  else console.log(JSON.stringify(result, null, 2));
  hostWindow.close();
  app.quit();
}

function onHostMessage(event, value) {
  if (!hostWindow || event.sender.id !== hostWindow.webContents.id) {
    rejectMessage('host', 'invalid-sender');
    return;
  }
  if (!isRecord(value) || value.token !== token) {
    rejectMessage('host', 'invalid-token-or-shape');
    return;
  }
  if (value.kind === 'host-ready') {
    result.hostChecks = {
      atomicChatVisibleToHost: value.hostAtomicChatVisible === true,
      mode: value.mode,
    };
    if (!baselineCaptured) {
      baselineCaptured = true;
      result.metrics.baseline = captureMetrics();
    }
    if (mode === 'view') createGameView();
    return;
  }
  acceptGameMessage('iframe', value, hostWindow.webContents);
}

function onGameMessage(event, value) {
  if (!gameView || event.sender.id !== gameView.webContents.id) {
    rejectMessage('game', 'invalid-sender');
    return;
  }
  acceptGameMessage('webcontents-view', value, event.sender);
}

async function start() {
  await app.whenReady();
  installNetworkPolicy(session.defaultSession);
  installGameProtocol(session.defaultSession);

  hostWindow = new BrowserWindow({
    width: 800,
    height: 640,
    show: false,
    webPreferences: {
      preload: HOST_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  hostWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  hostWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  hostWindow.webContents.on('console-message', (details) => {
    if (result.consoleMessages.length >= 32) return;
    const entry = {
      level: details.level,
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId,
    };
    if (!result.consoleMessages.some((current) => JSON.stringify(current) === JSON.stringify(entry)))
      result.consoleMessages.push(entry);
  });
  hostWindow.on('closed', () => {
    if (!finishing) app.quit();
  });

  ipcMain.on('spike.host-message', onHostMessage);
  ipcMain.on('spike.game-message', onGameMessage);

  const hostUrl = `${pathToFileURL(HOST_FILE).href}?mode=${mode}&token=${encodeURIComponent(token)}&gameUrl=${encodeURIComponent(gameUrl)}`;
  await hostWindow.loadURL(hostUrl);
  hostWindow.show();
  finishTimer = setTimeout(() => void finish(), 8000);
}

start().catch((error) => {
  result.startError = error?.message || String(error);
  if (jsonOutput) process.stdout.write(`${JSON.stringify(result)}\n`);
  else console.error(error);
  app.quit();
});

