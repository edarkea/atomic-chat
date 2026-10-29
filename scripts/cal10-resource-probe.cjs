const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const sampleCount = Math.max(1, Number.parseInt(process.env.ATOMIC_CAL10_SAMPLES || '5', 10));
const intervalMs = Math.max(
  100,
  Number.parseInt(process.env.ATOMIC_CAL10_INTERVAL_MS || '1000', 10),
);
const settleMs = Math.max(100, Number.parseInt(process.env.ATOMIC_CAL10_SETTLE_MS || '1500', 10));
const userDataPath = path.join(os.tmpdir(), `atomic-chat-cal10-electron-${process.pid}`);
app.setPath('userData', userDataPath);

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
      `${JSON.stringify({ scenario: 'offline-renderer-idle', sampleCount, intervalMs, settleMs, samples })}\n`,
    );
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await fsp.rm(userDataPath, { recursive: true, force: true });
    await app.quit();
  }
}

app
  .whenReady()
  .then(run)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
