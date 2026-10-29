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

  return { selectFileDestination, selectFileSource };
}

module.exports = { createFileDialogs };
