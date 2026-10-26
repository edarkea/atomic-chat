const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

class PersistenceStore {
  constructor(userDataPath) {
    const directory = path.join(userDataPath, 'data');
    fs.mkdirSync(directory, { recursive: true });
    this.database = new Database(path.join(directory, 'atomic-chat.sqlite'));
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.migrate();
  }

  migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_meta);
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        endpoint_host TEXT NOT NULL,
        endpoint_port INTEGER NOT NULL,
        tls INTEGER NOT NULL,
        credential_ref TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contacts (
        account_id TEXT NOT NULL,
        jid TEXT NOT NULL,
        name TEXT,
        groups_json TEXT NOT NULL DEFAULT '[]',
        PRIMARY KEY (account_id, jid),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        client_message_id TEXT NOT NULL UNIQUE,
        sender_jid TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS preferences (
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        preference_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, scope_id, preference_key)
      );
      UPDATE schema_meta SET version = 2 WHERE version < 2;
    `);
  }

  upsertAccount(account) {
    this.database.prepare(`INSERT INTO accounts(account_id, endpoint_host, endpoint_port, tls, credential_ref, created_at)
      VALUES (@accountId, @host, @port, @tls, @credentialRef, @createdAt)
      ON CONFLICT(account_id) DO UPDATE SET endpoint_host=@host, endpoint_port=@port, tls=@tls, credential_ref=@credentialRef`).run(account);
  }

  saveMessage(message) {
    this.database.prepare(`INSERT INTO messages(id, conversation_id, client_message_id, sender_jid, body, status, created_at)
      VALUES (@id, @conversationId, @clientMessageId, @senderJid, @body, @status, @createdAt)
      ON CONFLICT(client_message_id) DO UPDATE SET status=@status`).run({ ...message, body: JSON.stringify(message.body) });
  }

  listMessages(conversationId) {
    return this.database.prepare(`SELECT id, conversation_id AS conversationId, client_message_id AS clientMessageId,
      sender_jid AS senderJid, body, status, created_at AS createdAt
      FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(conversationId).map((row) => ({ ...row, body: JSON.parse(row.body) }));
  }

  getPreferences(scope, scopeId) {
    const rows = this.database.prepare('SELECT preference_key, value_json FROM preferences WHERE scope = ? AND scope_id = ?').all(scope, scopeId);
    return Object.fromEntries(rows.map((row) => [row.preference_key, JSON.parse(row.value_json)]));
  }

  updatePreferences(scope, scopeId, values) {
    const now = new Date().toISOString();
    const statement = this.database.prepare(`INSERT INTO preferences(scope, scope_id, preference_key, value_json, updated_at)
      VALUES (@scope, @scopeId, @key, @value, @updatedAt)
      ON CONFLICT(scope, scope_id, preference_key) DO UPDATE SET value_json=@value, updated_at=@updatedAt`);
    const transaction = this.database.transaction((entries) => entries.forEach(([key, value]) => statement.run({ scope, scopeId, key, value: JSON.stringify(value), updatedAt: now })));
    transaction(Object.entries(values));
    return this.getPreferences(scope, scopeId);
  }

  resetPreferences(scope, scopeId) {
    this.database.prepare('DELETE FROM preferences WHERE scope = ? AND scope_id = ?').run(scope, scopeId);
    return {};
  }

  close() { this.database.close(); }
}

module.exports = { PersistenceStore };
