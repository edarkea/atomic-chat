const path = require('node:path');

function safeTransferFileName(value) {
  const normalized = String(value || 'download').replaceAll('\\', '/');
  const base = path.posix.basename(normalized);
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return (cleaned || 'download').slice(0, 255);
}

async function nextAvailableDestination(directory, fileName, fsp) {
  const extension = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  for (let index = 0; index <= 10000; index += 1) {
    const suffix = index === 0 ? '' : ` (${index})`;
    const candidate = path.join(directory, `${stem}${suffix}${extension}`);
    try {
      await fsp.lstat(candidate);
    } catch (cause) {
      if (cause.code === 'ENOENT') return candidate;
      throw cause;
    }
  }
  const cause = new Error('download destination exhausted');
  cause.code = 'STORAGE_FAILED';
  throw cause;
}

function createFileDialogs({ dialog, fsp }) {
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
        if (cause.code === 'ENOENT') return result.filePath;
        return null;
      }
    }
  }

  async function selectFileSource() {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar archivo para enviar',
      properties: ['openFile'],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }

  async function selectStickerSource() {
    const result = await dialog.showOpenDialog({
      title: 'Importar sticker',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes estáticas', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }

  async function selectDownloadDirectory() {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar carpeta de descargas',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }

  async function selectDefaultFileDestination(directory, offer) {
    const destinationDirectory = path.resolve(directory);
    await fsp.mkdir(destinationDirectory, { recursive: true });
    const information = await fsp.lstat(destinationDirectory);
    if (!information.isDirectory() || information.isSymbolicLink()) {
      const cause = new Error('download directory is not trusted');
      cause.code = 'STORAGE_FAILED';
      throw cause;
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
