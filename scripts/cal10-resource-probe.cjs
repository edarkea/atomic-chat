const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const sampleCount = Math.max(1, Number.parseInt(process.env.ATOMIC_CAL10_SAMPLES || '5', 10));
const intervalMs = Math.max(
  100,
  Number.parseInt(process.env.ATOMIC_CAL10_INTERVAL_MS || '1000', 10),
);
const settleMs = Math.max(100, Number.parseInt(process.env.ATOMIC_CAL10_SETTLE_MS || '1500', 10));
const executionId = crypto.randomUUID();
let userDataPath;
try {
  userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-cal10-electron-'));
  app.setPath('userData', userDataPath);
} catch (error) {
  if (userDataPath) fs.rmSync(userDataPath, { recursive: true, force: true });
  console.error(`CAL-10 Electron probe initialization failed: ${error.message}`);
  process.exit(1);
}
function scheduleUserDataCleanup() {
  const cleanupScript = `
    const fs = require('node:fs');
    const targetPath = process.argv[1];
    const parentPid = Number(process.argv[2]);
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    (async () => {
      while (true) {
        try {
          process.kill(parentPid, 0);
          await wait(100);
        } catch {
          break;
        }
      }
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
          fs.rmSync(targetPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
          if (!fs.existsSync(targetPath)) process.exit(0);
        } catch {}
        await wait(100);
      }
      process.exit(1);
    })();
  `;
  const cleanupProcess = spawn(
    process.execPath,
    ['-e', cleanupScript, userDataPath, String(process.pid)],
    {
      detached: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  cleanupProcess.unref();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appMetricView(metric) {
  return {
    pid: metric.pid,
    type: metric.type,
    cpu: metric.cpu,
    memory: metric.memory,
  };
}

async function collectSample() {
  return {
    at: new Date().toISOString(),
    main: {
      pid: process.pid,
      memory: process.memoryUsage(),
      processMemory: await process.getProcessMemoryInfo(),
    },
    processes: app.getAppMetrics().map(appMetricView),
  };
}

async function run() {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await window.loadFile(
      path.resolve(__dirname, '..', 'dist', 'atomic-chat', 'browser', 'index.html'),
    );
    await wait(settleMs);
    const samples = [];
    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(await collectSample());
      if (index + 1 < sampleCount) await wait(intervalMs);
    }
    process.stdout.write(
      `${JSON.stringify({ scenario: 'offline-renderer-idle', executionId, pid: process.pid, sampleCount, intervalMs, settleMs, samples })}\n`,
    );
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

app
  .whenReady()
  .then(run)
  .then(() => {
    scheduleUserDataCleanup();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    scheduleUserDataCleanup();
    app.exit(1);
  });
