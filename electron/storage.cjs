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
    try { this.migrate(); } catch (error) { this.database.close(); throw error; }
  }

  migrate() {
    const migrate = this.database.transaction(() => { this.database.exec(`
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
        account_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        client_message_id TEXT NOT NULL,
        sender_jid TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (account_id, client_message_id),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
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
    const columns = this.database.prepare('PRAGMA table_info(messages)').all();
    const hasAccount = columns.some((column) => column.name === 'account_id');
    if (!hasAccount) {
      this.database.exec(`ALTER TABLE messages RENAME TO messages_legacy_unassigned;
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
          client_message_id TEXT NOT NULL, sender_jid TEXT NOT NULL, body TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
          UNIQUE (account_id, client_message_id)
        );
        CREATE TABLE IF NOT EXISTS message_recovery (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, client_message_id TEXT NOT NULL,
          sender_jid TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
          reason TEXT NOT NULL, quarantined_at TEXT NOT NULL
        );
        INSERT INTO message_recovery SELECT id, conversation_id, client_message_id, sender_jid, body, status, created_at,
          'account_identity_missing', datetime('now') FROM messages_legacy_unassigned;
        DROP TABLE messages_legacy_unassigned;
        UPDATE schema_meta SET version = 3;`);
    }
    const currentColumns = this.database.prepare('PRAGMA table_info(messages)').all();
    const recoveryColumns = this.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_recovery'").get() ? this.database.prepare('PRAGMA table_info(message_recovery)').all() : [];
    if (recoveryColumns.length && !recoveryColumns.some((column) => column.name === 'account_id')) this.database.exec('ALTER TABLE message_recovery ADD COLUMN account_id TEXT');
    const compositeIndex = this.database.prepare('PRAGMA index_list(messages)').all().some((index) => {
      const fields = this.database.prepare(`PRAGMA index_info('${index.name.replaceAll("'", "''")}')`).all().map((field) => field.name);
      return index.unique === 1 && fields.join(',') === 'account_id,client_message_id';
    });
    if (currentColumns.some((column) => column.name === 'account_id') && !compositeIndex) {
      this.database.exec(`ALTER TABLE messages RENAME TO messages_v3;
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
          client_message_id TEXT NOT NULL, sender_jid TEXT NOT NULL, body TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL,
          UNIQUE (account_id, client_message_id),
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS message_recovery (
          id TEXT PRIMARY KEY, account_id TEXT, conversation_id TEXT NOT NULL, client_message_id TEXT NOT NULL,
          sender_jid TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
          reason TEXT NOT NULL, quarantined_at TEXT NOT NULL
        );
        INSERT INTO messages(id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at)
          SELECT id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at
          FROM messages_v3 m WHERE m.rowid = (SELECT MIN(rowid) FROM messages_v3 x WHERE x.account_id = m.account_id AND x.client_message_id = m.client_message_id);
        INSERT OR IGNORE INTO message_recovery(id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at, reason, quarantined_at)
          SELECT id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at, 'duplicate_client_message_id', datetime('now')
          FROM messages_v3 m WHERE m.rowid != (SELECT MIN(rowid) FROM messages_v3 x WHERE x.account_id = m.account_id AND x.client_message_id = m.client_message_id);
        DROP TABLE messages_v3;
        UPDATE schema_meta SET version = 4;`);
    } else {
      this.database.exec(`CREATE INDEX IF NOT EXISTS idx_messages_account_conversation_created ON messages(account_id, conversation_id, created_at);`);
      this.database.prepare('UPDATE schema_meta SET version = 4').run();
    }
    }); migrate();
  }

  upsertAccount(account) {
    this.database.prepare(`INSERT INTO accounts(account_id, endpoint_host, endpoint_port, tls, credential_ref, created_at)
      VALUES (@accountId, @host, @port, @tls, @credentialRef, @createdAt)
      ON CONFLICT(account_id) DO UPDATE SET endpoint_host=@host, endpoint_port=@port, tls=@tls, credential_ref=@credentialRef`).run(account);
  }

  saveMessage(message) {
    if (!message.accountId) throw new Error('INVALID_INPUT');
    this.database.prepare(`INSERT INTO messages(id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at)
      VALUES (@id, @accountId, @conversationId, @clientMessageId, @senderJid, @body, @status, @createdAt)
      ON CONFLICT(account_id, client_message_id) DO UPDATE SET status=@status, body=@body`).run({ ...message, body: JSON.stringify(message.body) });
  }

  listMessages(accountId, conversationId) {
    return this.database.prepare(`SELECT id, conversation_id AS conversationId, client_message_id AS clientMessageId,
      sender_jid AS senderJid, body, status, created_at AS createdAt
      FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY created_at ASC`).all(accountId, conversationId).map((row) => ({ ...row, accountId, body: JSON.parse(row.body) }));
  }

  listConversations(accountId) {
    return this.database.prepare(`SELECT account_id AS accountId, conversation_id AS jid,
      MAX(created_at) AS lastActivity FROM messages WHERE account_id = ?
      GROUP BY account_id, conversation_id ORDER BY lastActivity DESC`).all(accountId);
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
