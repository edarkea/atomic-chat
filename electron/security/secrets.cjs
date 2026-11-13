const fs = require('node:fs');
const path = require('node:path');

function storageUnavailable() {
  return new Error('secret_unavailable');
}

function readSecretDocument(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return { kind: 'invalid' };
    const entries = Object.entries(parsed);
    if (entries.some(([reference, value]) => !reference || typeof value !== 'string' || !value))
      return { kind: 'invalid' };
    return { kind: 'valid', raw, values: new Map(entries) };
  } catch (error) {
    return error?.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'invalid' };
  }
}

class SecretStore {
  constructor(safeStorage, userDataPath) {
    this.safeStorage = safeStorage;
    this.file = path.join(userDataPath, 'secrets.json');
    this.backupFile = path.join(userDataPath, 'secrets.json.bak');
    this.storageStatus = 'available';
    const primary = readSecretDocument(this.file);
    if (primary.kind === 'valid') this.values = primary.values;
    else {
      const backup = readSecretDocument(this.backupFile);
      this.values = new Map();
      if (backup.kind === 'valid') this.storageStatus = 'recovery_available';
      else if (primary.kind === 'invalid' || backup.kind === 'invalid')
        this.storageStatus = 'corrupt';
    }
    this.sessionValues = new Map();
  }

  put(reference, secret, options = {}) {
    if (options.remember === false) {
      if (this.storageStatus === 'available') {
        const nextValues = new Map(this.values);
        nextValues.delete(reference);
        this.flush(nextValues);
        this.values = nextValues;
      }
      this.sessionValues.set(reference, secret);
      return;
    }
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('secret_unavailable');
    const encrypted = this.safeStorage.encryptString(secret);
    const nextValues = new Map(this.values);
    nextValues.set(reference, encrypted.toString('base64'));
    this.flush(nextValues);
    this.sessionValues.delete(reference);
    this.values = nextValues;
  }

  get(reference) {
    const temporary = this.sessionValues.get(reference);
    if (temporary !== undefined) return temporary;
    this.assertStorageAvailable();
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('secret_unavailable');
    const encrypted = this.values.get(reference);
    if (!encrypted) return undefined;
    return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  hasPersistent(reference) {
    return (
      this.getStatus() === 'available' &&
      this.safeStorage.isEncryptionAvailable() &&
      this.values.has(reference)
    );
  }

  getStatus() {
    if (!this.safeStorage.isEncryptionAvailable()) return 'unavailable';
    return this.storageStatus;
  }

  clearSession(reference) {
    this.sessionValues.delete(reference);
  }
  delete(reference) {
    const nextValues = new Map(this.values);
    nextValues.delete(reference);
    this.flush(nextValues);
    this.sessionValues.delete(reference);
    this.values = nextValues;
  }

  assertStorageAvailable() {
    if (this.storageStatus !== 'available') throw storageUnavailable();
  }

  recover() {
    if (this.storageStatus !== 'recovery_available') throw storageUnavailable();
    const backup = readSecretDocument(this.backupFile);
    if (backup.kind !== 'valid') throw storageUnavailable();
    let archivedFile;
    try {
      if (readSecretDocument(this.file).kind !== 'missing') {
        archivedFile = `${this.file}.corrupt-${process.pid}-${process.hrtime.bigint()}`;
        fs.renameSync(this.file, archivedFile);
      }
      this.writeAtomic(this.file, backup.raw);
    } catch {
      if (archivedFile && !fs.existsSync(this.file)) {
        try {
          fs.renameSync(archivedFile, this.file);
        } catch {
          // Preserve the original storage failure and the archived evidence.
        }
      }
      throw storageUnavailable();
    }
    this.values = backup.values;
    this.storageStatus = 'available';
  }

  reset() {
    if (!['corrupt', 'recovery_available'].includes(this.storageStatus)) throw storageUnavailable();
    let archivedFile;
    try {
      if (readSecretDocument(this.file).kind !== 'missing') {
        archivedFile = `${this.file}.corrupt-${process.pid}-${process.hrtime.bigint()}`;
        fs.renameSync(this.file, archivedFile);
      }
      this.writeAtomic(this.file, '{}');
      if (fs.existsSync(this.backupFile)) fs.unlinkSync(this.backupFile);
    } catch {
      if (archivedFile && !fs.existsSync(this.file)) {
        try {
          fs.renameSync(archivedFile, this.file);
        } catch {
          // Preserve the original storage failure and the archived evidence.
        }
      }
      throw storageUnavailable();
    }
    this.values = new Map();
    this.storageStatus = 'available';
  }

  flush(values) {
    this.assertStorageAvailable();
    const serialized = JSON.stringify(Object.fromEntries(values));
    this.writeAtomic(this.file, serialized);
    try {
      this.writeAtomic(this.backupFile, serialized);
    } catch {
      // The primary file is already durable; a missing backup only reduces
      // future recovery redundancy and must not report a false write failure.
    }
  }

  writeAtomic(file, contents) {
    const temporaryFile = `${file}.${process.pid}.${process.hrtime.bigint()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporaryFile, 'wx', 0o600);
      fs.writeFileSync(descriptor, contents, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.chmodSync(temporaryFile, 0o600);
      fs.renameSync(temporaryFile, file);
    } catch {
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch {
          // Preserve the storage error without masking it during cleanup.
        }
      }
      try {
        fs.unlinkSync(temporaryFile);
      } catch {
        // The temporary file may not have been created or may already be renamed.
      }
      throw storageUnavailable();
    }
  }
}

module.exports = { SecretStore };
