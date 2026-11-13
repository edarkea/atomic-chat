const path = require('node:path');

/**
 * @typedef {{name?: string}} TransferOffer
 * @typedef {{isDirectory: () => boolean, isSymbolicLink: () => boolean}} FileInformation
 * @typedef {{lstat: (filePath: string) => Promise<FileInformation>, mkdir: (directory: string, options?: {recursive?: boolean}) => Promise<unknown>}} FileSystemPromises
 * @typedef {{showSaveDialog: (options: Record<string, unknown>) => Promise<{canceled: boolean, filePath?: string}>, showOpenDialog: (options: Record<string, unknown>) => Promise<{canceled: boolean, filePaths: string[]}>, showMessageBox: (options: Record<string, unknown>) => Promise<{response: number}>}} FileDialogApi
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isMissingFile(error) {
  return isRecord(error) && error['code'] === 'ENOENT';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function safeTransferFileName(value) {
  const normalized = String(value || 'download').replaceAll('\\', '/');
  const base = path.posix.basename(normalized);
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || 'download').slice(0, 255);
}

/**
 * @param {string} directory
 * @param {string} fileName
 * @param {FileSystemPromises} fsp
 * @returns {Promise<string>}
 */
async function nextAvailableDestination(directory, fileName, fsp) {
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let index = 0; index <= 10000; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`;
    const candidate = path.join(directory, `${stem}${suffix}${extension}`);
    try {
      await fsp.lstat(candidate);
    } catch (cause) {
      if (isMissingFile(cause)) return candidate;
      throw cause;
    }
  }
  throw Object.assign(new Error('download destination exhausted'), { code: 'STORAGE_FAILED' });
}

/**
 * @param {{dialog: FileDialogApi, fsp: FileSystemPromises}} dependencies
 */
function createFileDialogs({ dialog, fsp }) {
  /**
   * @param {TransferOffer} offer
   * @returns {Promise<string | null>}
   */
  async function selectFileDestination(offer) {
    while (true) {
      const result = await dialog.showSaveDialog({
        title: 'Guardar archivo recibido',
        defaultPath: offer.name,
        properties: [],
      });
      if (result.canceled || !result.filePath) return null;
      try {
        await fsp.lstat(result.filePath);
        const choice = await dialog.showMessageBox({
          type: 'warning',
          buttons: ['Elegir otro', 'Cancelar'],
          defaultId: 0,
          cancelId: 1,
          message: 'El archivo de destino ya existe. Atomic Chat no sobrescribe archivos.',
        });
        if (choice.response !== 0) return null;
      } catch (cause) {
        if (isMissingFile(cause)) return result.filePath;
        return null;
      }
    }
  }

  /** @returns {Promise<string | null>} */
  async function selectFileSource() {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar archivo para enviar',
      properties: ['openFile'],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }

  /** @returns {Promise<string | null>} */
  async function selectStickerSource() {
    const result = await dialog.showOpenDialog({
      title: 'Importar sticker',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes estáticas', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }

  /** @returns {Promise<string | null>} */
  async function selectDownloadDirectory() {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar carpeta de descargas',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }

  /**
   * @param {string} directory
   * @param {TransferOffer | undefined} offer
   * @returns {Promise<string>}
   */
  async function selectDefaultFileDestination(directory, offer) {
    const destinationDirectory = path.resolve(directory);
    await fsp.mkdir(destinationDirectory, { recursive: true });
    const information = await fsp.lstat(destinationDirectory);
    if (!information.isDirectory() || information.isSymbolicLink()) {
      throw Object.assign(new Error('download directory is not trusted'), {
        code: 'STORAGE_FAILED',
      });
    }
    return nextAvailableDestination(destinationDirectory, safeTransferFileName(offer?.name), fsp);
  }

  return {
    selectFileDestination,
    selectFileSource,
    selectStickerSource,
    selectDownloadDirectory,
    selectDefaultFileDestination,
  };
}

module.exports = { createFileDialogs };
