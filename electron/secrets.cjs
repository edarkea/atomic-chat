const fs = require('node:fs');
const path = require('node:path');

class SecretStore {
  constructor(safeStorage, userDataPath) {
    this.safeStorage = safeStorage;
    this.file = path.join(userDataPath, 'secrets.json');
    this.values = fs.existsSync(this.file) ? new Map(Object.entries(JSON.parse(fs.readFileSync(this.file, 'utf8')))) : new Map();
  }

  put(reference, secret) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('secret_unavailable');
    const encrypted = this.safeStorage.encryptString(secret);
    this.values.set(reference, encrypted.toString('base64'));
    this.flush();
  }

  get(reference) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('secret_unavailable');
    const encrypted = this.values.get(reference);
    if (!encrypted) return undefined;
    return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  delete(reference) { this.values.delete(reference); this.flush(); }
  flush() { fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.values)), { mode: 0o600 }); }
}

module.exports = { SecretStore };
