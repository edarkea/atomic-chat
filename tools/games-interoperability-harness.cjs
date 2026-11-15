const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electronLocalTest = path.join(root, 'tests', 'games-electron-local.integration.cjs');

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    const name = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(name, next);
      index += 1;
    } else values.set(name, 'true');
  }
  return values;
}

function usage() {
  console.log(`Atomic Chat game interoperability harness

Levels:
  simulated       Existing two-adapter, SQLite and GameSessionManager tests (default).
  electron-local  Two isolated Electron BrowserWindows with real Preload/Renderer IPC.
  real            Fails closed unless explicitly authorized; never used by npm test.

Optional real-environment configuration (never logged):
  --server <host> --port <5222|5223> --transport <starttls|direct-tls>
  --account-a <bare-jid> --account-b <bare-jid>
  --resource-a <resource> --resource-b <resource>
  --data-root <directory> --timeout-ms <positive integer>

Real passwords, if a separately authorized runner is used, must come only from
ATOMIC_GAMES_TEST_PASSWORD_A and ATOMIC_GAMES_TEST_PASSWORD_B. This harness never
reads application credential stores and never prints password values.
`);
}

function value(args, name, fallback) {
  return (
    args.get(name) ||
    process.env[`ATOMIC_GAMES_TEST_${name.replaceAll('-', '_').toUpperCase()}`] ||
    fallback
  );
}

function positiveInteger(raw, fallback) {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function validateRealConfiguration(args) {
  const server = value(args, 'server', '');
  const accountA = value(args, 'account-a', '');
  const accountB = value(args, 'account-b', '');
  const port = positiveInteger(value(args, 'port', '5222'), 0);
  const transport = value(args, 'transport', 'starttls');
  const resourceA = value(args, 'resource-a', 'atomic-2g-a');
  const resourceB = value(args, 'resource-b', 'atomic-2g-b');
  const timeoutMs = positiveInteger(value(args, 'timeout-ms', '30000'), 30000);
  const dataRoot = value(args, 'data-root', '');
  if (!server || !accountA || !accountB || !dataRoot)
    throw new Error('BLOCKED: real XMPP requires explicit server, accounts and data-root');
  if (!['starttls', 'direct-tls'].includes(transport) || ![5222, 5223].includes(port))
    throw new Error('INVALID_INPUT: only secure starttls:5222 or direct-tls:5223 is allowed');
  if (accountA === accountB || resourceA === resourceB)
    throw new Error('INVALID_INPUT: accounts and resources must be distinct');
  if (!path.isAbsolute(dataRoot)) throw new Error('INVALID_INPUT: data-root must be absolute');
  return { server, accountA, accountB, port, transport, resourceA, resourceB, timeoutMs, dataRoot };
}

function runSimulated() {
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      'tests/games-phase-2f.test.cjs',
      'tests/xmpp-games.test.cjs',
      'tests/games-main.test.cjs',
      'tests/games-ipc.test.cjs',
    ],
    { cwd: root, env: { ...process.env, NODE_ENV: 'test' }, stdio: 'inherit' },
  );
  console.log(
    JSON.stringify({
      suite: 'games-interoperability-harness',
      evidenceLevel: 1,
      result: result.status === 0 ? 'PASS' : 'FAIL',
    }),
  );
  return result.status ?? 1;
}

function runElectronLocal(args) {
  if (process.versions.electron) return 0;
  if (!fs.existsSync(path.join(root, 'dist', 'atomic-chat', 'browser', 'index.html')))
    throw new Error('BLOCKED: run npm run build:electron before the Electron-local harness');
  const electronBinary = require('electron');
  const childEnvironment = { ...process.env, ATOMIC_GAMES_REAL_NETWORK: '0' };
  delete childEnvironment.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(electronBinary, [electronLocalTest, ...args], {
    cwd: root,
    env: childEnvironment,
    stdio: 'inherit',
  });
  return child.status ?? 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has('help')) {
    usage();
    return 0;
  }
  const level = args.get('level') || 'simulated';
  if (level === 'simulated') return runSimulated();
  if (level === 'electron-local') return runElectronLocal(process.argv.slice(2));
  if (level === 'real') {
    if (args.get('authorize-real-network') !== 'true') {
      console.log(
        JSON.stringify({
          suite: 'games-interoperability-harness',
          evidenceLevel: 3,
          result: 'BLOCKED',
          reason: 'No explicit user authorization for real XMPP network',
        }),
      );
      return 2;
    }
    const configuration = validateRealConfiguration(args);
    if (process.env.ATOMIC_GAMES_REAL_AUTHORIZED !== '1') {
      console.log(
        JSON.stringify({
          suite: 'games-interoperability-harness',
          evidenceLevel: 3,
          result: 'BLOCKED',
          reason: 'Authorized runner marker is absent',
          server: configuration.server,
          transport: configuration.transport,
          port: configuration.port,
        }),
      );
      return 2;
    }
    throw new Error('BLOCKED: real-client execution is prepared but not enabled in this workspace');
  }
  usage();
  throw new Error(`INVALID_INPUT: unsupported level ${level}`);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(
    JSON.stringify({
      suite: 'games-interoperability-harness',
      result: 'BLOCKED',
      reason: error.message,
    }),
  );
  process.exitCode = 2;
}
