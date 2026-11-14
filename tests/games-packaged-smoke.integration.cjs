const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const {
  PACKAGED_SMOKE_FLAG,
  PACKAGED_SMOKE_ROOT,
  validatePackagedSmokeRoot,
} = require('../electron/security/packaged-smoke-isolation.cjs');

const ACCOUNT_ID = 'smoke@example.invalid';

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`CDP HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
  });
}

async function waitForPage(port, child) {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged Electron exited with ${child.exitCode}`);
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for packaged page: ${lastError?.message || 'unknown error'}`);
}

function connectDevTools(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return {
    async command(method, params = {}) {
      await ready;
      const id = ++sequence;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      socket.close();
    },
  };
}

function evaluate(client, expression) {
  return client
    .command('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    })
    .then((result) => {
      if (result.exceptionDetails) throw new Error('Packaged renderer evaluation failed');
      return result.result?.value;
    });
}

function findDatabase(root) {
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.name === 'atomic-chat.sqlite') return fullPath;
    }
  }
  return undefined;
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

async function main() {
  const executable = process.argv[2] || process.env.ATOMIC_PACKAGED_EXE;
  if (!executable)
    throw new Error('Usage: node tests/games-packaged-smoke.integration.cjs <Atomic Chat.exe>');
  const executablePath = path.resolve(executable);
  if (!fs.existsSync(executablePath))
    throw new Error(`Packaged executable not found: ${executablePath}`);

  const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-packaged-smoke-'));
  let isolatedRoot;
  try {
    isolatedRoot = validatePackagedSmokeRoot(userDataRoot);
  } catch (error) {
    fs.rmSync(userDataRoot, { recursive: true, force: true });
    throw error;
  }
  const debugServer = require('node:net').createServer();
  await new Promise((resolve) => debugServer.listen(0, '127.0.0.1', resolve));
  const port = debugServer.address().port;
  debugServer.close();
  const environment = {
    ...process.env,
    [PACKAGED_SMOKE_FLAG]: '1',
    [PACKAGED_SMOKE_ROOT]: isolatedRoot.root,
    ATOMIC_XMPP_USERNAME: ACCOUNT_ID,
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    executablePath,
    [
      '--no-sandbox',
      '--disable-gpu',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataRoot}`,
    ],
    { cwd: userDataRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (stderr += chunk));
  let client;
  try {
    const page = await waitForPage(port, child);
    client = connectDevTools(page.webSocketDebuggerUrl);
    const result = await evaluate(
      client,
      `((async () => {
        const accountId = ${JSON.stringify(ACCOUNT_ID)};
        const catalog = await window.atomicChat.games.catalog({ version: 1, requestId: 'packaged-catalog', accountId });
        const sessions = await window.atomicChat.games.sessions({ version: 1, requestId: 'packaged-sessions', accountId, conversationId: 'peer@example.invalid' });
        return {
          hasGames: Boolean(window.atomicChat?.games),
          hasNode: typeof window.require !== 'undefined' || typeof window.process !== 'undefined',
          catalog,
          sessions,
          bodyLoaded: Boolean(document.body),
        };
      })())`,
    );
    assert.equal(result.hasGames, true);
    assert.equal(result.hasNode, false);
    assert.equal(result.bodyLoaded, true);
    assert.equal(result.catalog.ok, true);
    assert.deepEqual(
      result.catalog.value.map((entry) => entry.gameId),
      ['com.atomicchat.tic-tac-toe', 'com.atomicchat.reversi'],
    );
    assert.equal(result.sessions.ok, true);
    assert.deepEqual(result.sessions.value, []);
    await client.command('Page.close');
    const exitCode = await Promise.race([
      waitForExit(child),
      new Promise((resolve) => setTimeout(() => resolve(undefined), 10000)),
    ]);
    assert.equal(exitCode, 0, `Packaged Electron did not shut down cleanly: ${stderr}`);
  } finally {
    client?.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([waitForExit(child), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    const databasePath = findDatabase(userDataRoot);
    assert.ok(databasePath, 'Packaged Electron did not initialize SQLite');
    if (databasePath) {
      const database = new Database(databasePath, { readonly: true });
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => row.name);
      for (const table of ['game_sessions', 'game_events', 'game_snapshots', 'game_results'])
        assert.equal(tables.includes(table), true, `Missing packaged SQLite table: ${table}`);
      database.close();
    }
    try {
      fs.rmSync(userDataRoot, { recursive: true, force: true });
    } catch (error) {
      console.error(
        JSON.stringify({
          suite: 'games-packaged-smoke',
          result: 'CLEANUP_WARNING',
          message: error.message,
        }),
      );
    }
  }
  console.log(
    JSON.stringify({
      suite: 'games-packaged-smoke',
      result: 'PASS',
      platform: process.platform,
      arch: process.arch,
    }),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({ suite: 'games-packaged-smoke', result: 'FAIL', message: error.message }),
  );
  process.exitCode = 1;
});
