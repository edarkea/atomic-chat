// @ts-check

/** @typedef {{version: 1, requestId: string}} UpdateRequest */
/** @typedef {{version: 1, state: string, currentVersion: string, availableVersion?: string, progressPercent?: number, errorCode?: string, requestId?: string, correlationId?: string}} UpdateStatus */
/** @typedef {{handle: (channel: string, listener: (event: unknown, input: unknown) => Promise<unknown>) => void}} IpcMainLike */
/** @typedef {{getStatus: (input: UpdateRequest) => UpdateStatus, check: (input: UpdateRequest) => Promise<UpdateStatus>, download: (input: UpdateRequest) => Promise<UpdateStatus>, install: (input: UpdateRequest) => Promise<UpdateStatus>}} UpdateServiceLike */
/**
 * @param {{ipcMain: IpcMainLike, assertSender: (event: unknown) => void, updateService: UpdateServiceLike}} options
 */
function registerUpdateHandlers({ ipcMain, assertSender, updateService }) {
  /** @param {unknown} input @returns {UpdateRequest} */
  const request = (input) => {
    const value =
      input && typeof input === 'object'
        ? /** @type {{version?: unknown, requestId?: unknown}} */ (input)
        : undefined;
    if (
      !value ||
      value.version !== 1 ||
      typeof value.requestId !== 'string' ||
      !value.requestId.trim()
    )
      throw new Error('INVALID_INPUT');
    return { version: 1, requestId: value.requestId.trim() };
  };
  /** @param {unknown} value */
  const codeOf = (value) =>
    value &&
    typeof value === 'object' &&
    typeof (/** @type {{code?: unknown}} */ (value).code) === 'string'
      ? /** @type {{code: string}} */ (value).code
      : undefined;
  /** @param {unknown} event @param {unknown} input @param {(value: UpdateRequest) => Promise<UpdateStatus> | UpdateStatus} operation */
  const result = async (event, input, operation) => {
    assertSender(event);
    const valid = request(input);
    try {
      return { ok: true, version: 1, requestId: valid.requestId, value: await operation(valid) };
    } catch (cause) {
      const causeCode = codeOf(cause);
      const code =
        causeCode === 'INVALID_INPUT' ||
        causeCode === 'UNSUPPORTED' ||
        causeCode === 'CONFLICT' ||
        causeCode === 'INTERNAL'
          ? causeCode
          : 'INTERNAL';
      const message =
        cause &&
        typeof cause === 'object' &&
        typeof (/** @type {{message?: unknown}} */ (cause).message) === 'string'
          ? /** @type {{message: string}} */ (cause).message
          : 'No fue posible completar la actualización.';
      return {
        ok: false,
        version: 1,
        error: {
          code,
          retryable: code === 'INTERNAL',
          requestId: valid.requestId,
          message,
        },
      };
    }
  };
  ipcMain.handle('updates.getStatus', (event, input) =>
    result(event, input, (value) => updateService.getStatus(value)),
  );
  ipcMain.handle('updates.check', (event, input) =>
    result(event, input, (value) => updateService.check(value)),
  );
  ipcMain.handle('updates.download', (event, input) =>
    result(event, input, (value) => updateService.download(value)),
  );
  ipcMain.handle('updates.install', (event, input) =>
    result(event, input, (value) => updateService.install(value)),
  );
}

module.exports = { registerUpdateHandlers };
