const fs = require('node:fs');
const path = require('node:path');

class SecretStore {
  constructor(safeStorage, userDataPath) {
    this.safeStorage = safeStorage;
    this.file = path.join(userDataPath, 'secrets.json');
    this.values = fs.existsSync(this.file)
      ? new Map(Object.entries(JSON.parse(fs.readFileSync(this.file, 'utf8'))))
      : new Map();
    this.sessionValues = new Map();
  }

  put(reference, secret, options = {}) {
    if (options.remember === false) {
      this.sessionValues.set(reference, secret);
      this.values.delete(reference);
      this.flush();
      return;
    }
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('secret_unavailable');
    const encrypted = this.safeStorage.encryptString(secret);
    this.sessionValues.delete(reference);
    this.values.set(reference, encrypted.toString('base64'));
    this.flush();
  }

  get(reference) {
    const temporary = this.sessionValues.get(reference);
    if (temporary !== undefined) return temporary;
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('secret_unavailable');
    const encrypted = this.values.get(reference);
    if (!encrypted) return undefined;
    return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  hasPersistent(reference) {
    return this.safeStorage.isEncryptionAvailable() && this.values.has(reference);
  }

  clearSession(reference) {
    this.sessionValues.delete(reference);
  }
  delete(reference) {
    this.sessionValues.delete(reference);
    this.values.delete(reference);
    this.flush();
  }
  flush() {
    fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.values)), { mode: 0o600 });
  }
}

module.exports = { SecretStore };
