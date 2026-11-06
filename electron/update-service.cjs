// @ts-check

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * @typedef {'idle'|'checking'|'available'|'downloading'|'downloaded'|'up-to-date'|'error'} UpdateState
 * @typedef {{version: 1, state: UpdateState, currentVersion: string, availableVersion?: string, progressPercent?: number, errorCode?: string, requestId?: string, correlationId?: string}} UpdateStatus
 * @typedef {{version: 1, requestId: string}} UpdateRequest
 * @typedef {{autoDownload: boolean, autoInstallOnAppQuit: boolean, allowPrerelease: boolean, allowDowngrade: boolean, channel: string, on: (event: string, listener: (...args: unknown[]) => void) => void, setFeedURL?: (configuration: Record<string, string>) => void, checkForUpdates: () => Promise<unknown>, downloadUpdate: () => Promise<unknown>, quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void}} AutoUpdaterLike
 * @typedef {Error & {code?: string, requestId?: string}} UpdateError
 */

/** @param {unknown} value */
function versionOf(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '0.0.0';
}

/** @param {unknown} value */
function updateVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : undefined;
}

/** @param {string} requestId @param {string} code @param {string} message */
function updateError(requestId, code, message) {
  /** @type {UpdateError} */
  const error = new Error(message);
  error.code = code;
  error.requestId = requestId;
  return error;
}

/** @param {unknown} value @param {string} key */
function property(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  const record = /** @type {Record<string, unknown>} */ (value);
  return key in record ? record[key] : undefined;
}

/** @param {unknown} value */
function errorCode(value) {
  const code = property(value, 'code');
  return typeof code === 'string' ? code : undefined;
}

/**
 * @param {{
 *   app: {isPackaged?: boolean, getVersion?: () => string},
 *   applicationVersion?: string,
 *   isPackaged?: boolean,
 *   autoUpdaterFactory?: () => AutoUpdaterLike,
 *   hasCriticalTransfers?: () => boolean,
 *   intervalMs?: number,
 *   logger?: {warn?: (...args: unknown[]) => void},
 * }} options
 */
function createUpdateService(options) {
  const isPackaged = options.isPackaged ?? options.app.isPackaged === true;
  const currentVersion = () => versionOf(options.applicationVersion || options.app.getVersion?.());
  /** @type {Set<(status: UpdateStatus) => void>} */
  const listeners = new Set();
  const intervalMs = Math.max(60_000, options.intervalMs ?? UPDATE_INTERVAL_MS);
  /** @type {AutoUpdaterLike | undefined} */
  let updater;
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let timer;
  let started = false;
  /** @type {UpdateStatus} */
  let status = { version: 1, state: 'idle', currentVersion: currentVersion() };

  /** @param {Partial<UpdateStatus>} patch @param {string | undefined} [requestId] */
  const emit = (patch, requestId) => {
    status = {
      ...status,
      ...patch,
      version: 1,
      currentVersion: currentVersion(),
      ...(requestId ? { requestId, correlationId: `update:${requestId}` } : {}),
    };
    for (const listener of listeners) listener(status);
  };

  const attachUpdater = () => {
    if (updater || !isPackaged) return;
    updater = options.autoUpdaterFactory
      ? options.autoUpdaterFactory()
      : /** @type {AutoUpdaterLike} */ (
          /** @type {unknown} */ (require('electron-updater').autoUpdater)
        );
    const activeUpdater = updater;
    activeUpdater.autoDownload = false;
    activeUpdater.autoInstallOnAppQuit = false;
    activeUpdater.allowPrerelease = false;
    activeUpdater.allowDowngrade = false;
    activeUpdater.channel = 'latest';
    activeUpdater.setFeedURL?.({
      provider: 'github',
      owner: 'edarkea',
      repo: 'atomic-chat',
      releaseType: 'release',
    });
    activeUpdater.on('checking-for-update', () =>
      emit({ state: 'checking', progressPercent: undefined }),
    );
    activeUpdater.on('update-available', (information) =>
      emit({
        state: 'available',
        availableVersion: updateVersion(property(information, 'version')),
        progressPercent: undefined,
        errorCode: undefined,
      }),
    );
    activeUpdater.on('update-not-available', () =>
      emit({ state: 'up-to-date', availableVersion: undefined, progressPercent: undefined, errorCode: undefined }),
    );
    activeUpdater.on('download-progress', (progress) => {
      const percent = property(progress, 'percent');
      emit({
        state: 'downloading',
        progressPercent:
          typeof percent === 'number'
            ? Math.min(100, Math.max(0, Math.round(percent * 100) / 100))
            : undefined,
      });
    });
    activeUpdater.on('update-downloaded', (information) =>
      emit({
        state: 'downloaded',
        availableVersion:
          updateVersion(property(information, 'version')) || status.availableVersion,
        progressPercent: 100,
        errorCode: undefined,
      }),
    );
    activeUpdater.on('error', (cause) => {
      options.logger?.warn?.('[UPDATE] updater error', errorCode(cause) || 'INTERNAL');
      emit({ state: 'error', errorCode: 'INTERNAL', progressPercent: undefined });
    });
  };

  /** @param {UpdateRequest} request */
  const unsupported = (request) => {
    throw updateError(
      request.requestId,
      'UNSUPPORTED',
      'Las actualizaciones requieren una aplicación empaquetada.',
    );
  };

  /** @param {UpdateRequest} request @param {() => Promise<void>} action */
  const execute = async (request, action) => {
    if (!isPackaged) unsupported(request);
    attachUpdater();
    try {
      await action();
      return status;
    } catch (cause) {
      const code = errorCode(cause) === 'CONFLICT' ? 'CONFLICT' : 'INTERNAL';
      if (code === 'CONFLICT') throw cause;
      emit({ state: 'error', errorCode: code, progressPercent: undefined }, request.requestId);
      throw updateError(request.requestId, code, 'No fue posible completar la actualización.');
    }
  };

  const service = {
    /** @param {UpdateRequest} request */
    getStatus(request) {
      return {
        ...status,
        requestId: request.requestId,
        correlationId: `update:${request.requestId}`,
      };
    },
    /** @param {UpdateRequest} request */
    check(request) {
      return execute(request, async () => {
        if (['checking', 'downloading', 'downloaded'].includes(status.state)) return;
        const activeUpdater = updater;
        if (!activeUpdater)
          throw updateError(request.requestId, 'INTERNAL', 'Updater unavailable.');
        emit(
          { state: 'checking', progressPercent: undefined, errorCode: undefined },
          request.requestId,
        );
        await activeUpdater.checkForUpdates();
        if (status.state === 'checking') emit({ state: 'up-to-date' }, request.requestId);
      });
    },
    /** @param {UpdateRequest} request */
    download(request) {
      return execute(request, async () => {
        const activeUpdater = updater;
        if (!activeUpdater)
          throw updateError(request.requestId, 'INTERNAL', 'Updater unavailable.');
        if (status.state !== 'available')
          throw updateError(
            request.requestId,
            'CONFLICT',
            'No hay una actualización disponible para descargar.',
          );
        emit({ state: 'downloading', progressPercent: 0 }, request.requestId);
        await activeUpdater.downloadUpdate();
      });
    },
    /** @param {UpdateRequest} request */
    install(request) {
      return execute(request, async () => {
        const activeUpdater = updater;
        if (!activeUpdater)
          throw updateError(request.requestId, 'INTERNAL', 'Updater unavailable.');
        if (status.state !== 'downloaded')
          throw updateError(
            request.requestId,
            'CONFLICT',
            'La actualización aún no está descargada.',
          );
        if (options.hasCriticalTransfers?.())
          throw updateError(
            request.requestId,
            'CONFLICT',
            'Espera a que terminen las transferencias activas.',
          );
        activeUpdater.quitAndInstall(false, true);
      });
    },
    /** @param {(status: UpdateStatus) => void} listener */
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started || !isPackaged) return;
      started = true;
      attachUpdater();
      void service.check({ version: 1, requestId: 'update-startup' }).catch(() => undefined);
      timer = setInterval(() => {
        void service.check({ version: 1, requestId: 'update-periodic' }).catch(() => undefined);
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      started = false;
    },
  };
  return service;
}

module.exports = { UPDATE_INTERVAL_MS, createUpdateService };
