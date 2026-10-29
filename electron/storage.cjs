const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

class PersistenceStore {
  constructor(userDataPath) {
    const directory = path.join(userDataPath, 'data');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const databasePath = path.join(directory, 'atomic-chat.sqlite');
    this.database = new Database(databasePath);
    try {
      fs.chmodSync(directory, 0o700);
      fs.chmodSync(databasePath, 0o600);
    } catch {
      /* Windows ACLs are managed by the userData directory. */
    }
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    try {
      this.migrate();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  migrate() {
    const migrate = this.database.transaction(() => {
      this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta(version) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_meta);
      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        endpoint_host TEXT NOT NULL,
        endpoint_port INTEGER NOT NULL,
        tls INTEGER NOT NULL,
        transport TEXT NOT NULL DEFAULT 'direct-tls',
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
      CREATE TABLE IF NOT EXISTS trusted_certificates (
        account_id TEXT NOT NULL,
        endpoint_host TEXT NOT NULL,
        endpoint_port INTEGER NOT NULL,
        transport TEXT NOT NULL,
        fingerprint_sha256 TEXT NOT NULL,
        certificate_pem TEXT NOT NULL,
        identity_mismatch INTEGER NOT NULL DEFAULT 0,
        approved_at TEXT NOT NULL,
        PRIMARY KEY (account_id, endpoint_host, endpoint_port, transport),
        FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS connection_profiles (
        account_id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('automatic', 'manual')),
        manual_host TEXT,
        manual_port INTEGER,
        manual_transport TEXT,
        updated_at TEXT NOT NULL
      );
      UPDATE schema_meta SET version = 2 WHERE version < 2;
    `);
      const accountColumns = this.database.prepare('PRAGMA table_info(accounts)').all();
      if (!accountColumns.some((column) => column.name === 'transport'))
        this.database.exec(
          "ALTER TABLE accounts ADD COLUMN transport TEXT NOT NULL DEFAULT 'direct-tls'",
        );
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
      const recoveryColumns = this.database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'message_recovery'",
        )
        .get()
        ? this.database.prepare('PRAGMA table_info(message_recovery)').all()
        : [];
      if (recoveryColumns.length && !recoveryColumns.some((column) => column.name === 'account_id'))
        this.database.exec('ALTER TABLE message_recovery ADD COLUMN account_id TEXT');
      const compositeIndex = this.database
        .prepare('PRAGMA index_list(messages)')
        .all()
        .some((index) => {
          const fields = this.database
            .prepare(`PRAGMA index_info('${index.name.replaceAll("'", "''")}')`)
            .all()
            .map((field) => field.name);
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
        this.database.exec(
          `CREATE INDEX IF NOT EXISTS idx_messages_account_conversation_created ON messages(account_id, conversation_id, created_at); CREATE INDEX IF NOT EXISTS idx_messages_account_conversation_created_id ON messages(account_id, conversation_id, created_at, id);`,
        );
        this.database.prepare('UPDATE schema_meta SET version = 4').run();
      }
      this.database.exec(
        'CREATE INDEX IF NOT EXISTS idx_messages_account_conversation_created_id ON messages(account_id, conversation_id, created_at, id);',
      );
      this.database.exec(
        "CREATE TABLE IF NOT EXISTS connection_profiles (account_id TEXT PRIMARY KEY, domain TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('automatic', 'manual')), manual_host TEXT, manual_port INTEGER, manual_transport TEXT, updated_at TEXT NOT NULL);",
      );
      this.database.exec(
        'CREATE TABLE IF NOT EXISTS deleted_connection_profiles (account_id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);',
      );
      this.database.prepare('UPDATE schema_meta SET version = 5').run();
      const trustedCertificateColumns = this.database
        .prepare('PRAGMA table_info(trusted_certificates)')
        .all();
      if (!trustedCertificateColumns.some((column) => column.name === 'identity_mismatch'))
        this.database.exec(
          'ALTER TABLE trusted_certificates ADD COLUMN identity_mismatch INTEGER NOT NULL DEFAULT 0',
        );
      this.database.prepare('UPDATE schema_meta SET version = 6').run();
    });
    migrate();
  }

  upsertAccount(account) {
    const value = {
      ...account,
      transport: account.transport || (account.tls ? 'direct-tls' : 'starttls'),
    };
    this.database
      .prepare(
        `INSERT INTO accounts(account_id, endpoint_host, endpoint_port, tls, transport, credential_ref, created_at)
      VALUES (@accountId, @host, @port, @tls, @transport, @credentialRef, @createdAt)
      ON CONFLICT(account_id) DO UPDATE SET endpoint_host=@host, endpoint_port=@port, tls=@tls, transport=@transport, credential_ref=@credentialRef`,
      )
      .run(value);
  }

  saveConnectionProfile(profile) {
    const manual = profile.mode === 'manual' ? profile.manualEndpoint : undefined;
    this.database
      .prepare('DELETE FROM deleted_connection_profiles WHERE account_id = ?')
      .run(profile.accountId);
    this.database
      .prepare(
        `INSERT INTO connection_profiles(account_id, domain, mode, manual_host, manual_port, manual_transport, updated_at)
      VALUES (@accountId, @domain, @mode, @host, @port, @transport, @updatedAt)
      ON CONFLICT(account_id) DO UPDATE SET domain=@domain, mode=@mode, manual_host=@host,
      manual_port=@port, manual_transport=@transport, updated_at=@updatedAt`,
      )
      .run({
        accountId: profile.accountId,
        domain: profile.domain,
        mode: profile.mode,
        host: manual?.host || null,
        port: manual?.port || null,
        transport: manual?.transport || null,
        updatedAt: profile.updatedAt,
      });
    return this.getConnectionProfile(profile.accountId);
  }

  getConnectionProfile(accountId) {
    if (
      this.database
        .prepare('SELECT 1 FROM deleted_connection_profiles WHERE account_id = ?')
        .get(accountId)
    )
      return null;
    const row = this.database
      .prepare(
        `SELECT account_id AS accountId, domain, mode,
      manual_host AS host, manual_port AS port, manual_transport AS transport, updated_at AS updatedAt
      FROM connection_profiles WHERE account_id = ?`,
      )
      .get(accountId);
    if (row) return this.profileFromRow(row);
    const legacy = this.database
      .prepare(
        `SELECT account_id AS accountId, endpoint_host AS host,
      endpoint_port AS port, transport, created_at AS updatedAt FROM accounts WHERE account_id = ?`,
      )
      .get(accountId);
    if (!legacy) return null;
    return this.legacyProfile(legacy);
  }

  listConnectionProfiles() {
    const rows = this.database
      .prepare(
        `SELECT account_id AS accountId, domain, mode,
      manual_host AS host, manual_port AS port, manual_transport AS transport, updated_at AS updatedAt
      FROM connection_profiles ORDER BY updated_at DESC, account_id ASC`,
      )
      .all();
    const known = new Set(rows.map((row) => row.accountId));
    const deleted = new Set(
      this.database
        .prepare('SELECT account_id AS accountId FROM deleted_connection_profiles')
        .all()
        .map((row) => row.accountId),
    );
    const legacy = this.database
      .prepare(
        `SELECT account_id AS accountId, endpoint_host AS host,
      endpoint_port AS port, transport, created_at AS updatedAt FROM accounts ORDER BY created_at DESC, account_id ASC`,
      )
      .all();
    return rows
      .map((row) => this.profileFromRow(row))
      .concat(
        legacy
          .filter((row) => !known.has(row.accountId) && !deleted.has(row.accountId))
          .map((row) => this.legacyProfile(row)),
      );
  }

  deleteConnectionProfile(accountId) {
    this.database.prepare('DELETE FROM connection_profiles WHERE account_id = ?').run(accountId);
    this.database
      .prepare(
        'INSERT INTO deleted_connection_profiles(account_id, deleted_at) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET deleted_at=excluded.deleted_at',
      )
      .run(accountId, new Date().toISOString());
  }

  profileFromRow(row) {
    return {
      accountId: row.accountId,
      domain: row.domain,
      mode: row.mode,
      ...(row.mode === 'manual'
        ? { manualEndpoint: { host: row.host, port: row.port, transport: row.transport } }
        : {}),
      updatedAt: row.updatedAt,
    };
  }

  legacyProfile(row) {
    return {
      accountId: row.accountId,
      domain: row.accountId.includes('@')
        ? row.accountId.slice(row.accountId.lastIndexOf('@') + 1)
        : '',
      mode: 'manual',
      manualEndpoint: { host: row.host, port: row.port, transport: row.transport || 'starttls' },
      updatedAt: row.updatedAt,
    };
  }

  getTrustedCertificate(accountId, host, port, transport) {
    const row = this.database
      .prepare(
        `SELECT account_id AS accountId, endpoint_host AS host, endpoint_port AS port,
      transport, fingerprint_sha256 AS fingerprintSha256, certificate_pem AS certificatePem,
      identity_mismatch AS identityMismatchAuthorized, approved_at AS approvedAt
      FROM trusted_certificates WHERE account_id = ? AND endpoint_host = ? AND endpoint_port = ? AND transport = ?`,
      )
      .get(accountId, host, port, transport);
    return row ? { ...row, identityMismatchAuthorized: Boolean(row.identityMismatchAuthorized) } : null;
  }

  upsertTrustedCertificate(record) {
    this.database
      .prepare(
        `INSERT INTO trusted_certificates(account_id, endpoint_host, endpoint_port, transport, fingerprint_sha256, certificate_pem, identity_mismatch, approved_at)
      VALUES (@accountId, @host, @port, @transport, @fingerprintSha256, @certificatePem, @identityMismatchAuthorized, @approvedAt)
      ON CONFLICT(account_id, endpoint_host, endpoint_port, transport) DO UPDATE SET
        fingerprint_sha256=@fingerprintSha256, certificate_pem=@certificatePem,
        identity_mismatch=@identityMismatchAuthorized, approved_at=@approvedAt`,
      )
      .run({ ...record, identityMismatchAuthorized: record.identityMismatchAuthorized ? 1 : 0 });
  }

  saveMessage(message) {
    if (!message.accountId) throw new Error('INVALID_INPUT');
    this.database
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at)
      VALUES (@id, @accountId, @conversationId, @clientMessageId, @senderJid, @body, @status, @createdAt)
      ON CONFLICT(account_id, client_message_id) DO UPDATE SET status=@status, body=@body`,
      )
      .run({ ...message, body: JSON.stringify(message.body) });
  }

  listMessages(accountId, conversationId) {
    return this.database
      .prepare(
        `SELECT id, conversation_id AS conversationId, client_message_id AS clientMessageId,
      sender_jid AS senderJid, body, status, created_at AS createdAt
      FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(accountId, conversationId)
      .map((row) => ({ ...row, accountId, body: JSON.parse(row.body) }));
  }

  listMessagesPage(accountId, conversationId, limit, direction, cursor) {
    const values = [accountId, conversationId];
    let order = 'ORDER BY created_at DESC, id DESC';
    let predicate = '';
    if (cursor) {
      if (direction === 'older') {
        predicate = ' AND (created_at < ? OR (created_at = ? AND id < ?))';
        values.push(cursor.createdAt, cursor.createdAt, cursor.id);
      } else {
        predicate = ' AND (created_at > ? OR (created_at = ? AND id > ?))';
        values.push(cursor.createdAt, cursor.createdAt, cursor.id);
        order = 'ORDER BY created_at ASC, id ASC';
      }
    }
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id AS conversationId, client_message_id AS clientMessageId,
      sender_jid AS senderJid, body, status, created_at AS createdAt FROM messages
      WHERE account_id = ? AND conversation_id = ?${predicate} ${order} LIMIT ?`,
      )
      .all(...values, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows
      .slice(0, limit)
      .map((row) => ({ ...row, accountId, body: JSON.parse(row.body) }));
    if (direction === 'older') page.reverse();
    return { items: page, hasMore };
  }

  listConversations(accountId) {
    return this.database
      .prepare(
        `SELECT account_id AS accountId, conversation_id AS jid,
      MAX(created_at) AS lastActivity FROM messages WHERE account_id = ?
      GROUP BY account_id, conversation_id ORDER BY lastActivity DESC`,
      )
      .all(accountId);
  }

  getPreferences(scope, scopeId) {
    const rows = this.database
      .prepare(
        'SELECT preference_key, value_json FROM preferences WHERE scope = ? AND scope_id = ?',
      )
      .all(scope, scopeId);
    return Object.fromEntries(rows.map((row) => [row.preference_key, JSON.parse(row.value_json)]));
  }

  updatePreferences(scope, scopeId, values) {
    const now = new Date().toISOString();
    const statement = this.database
      .prepare(`INSERT INTO preferences(scope, scope_id, preference_key, value_json, updated_at)
      VALUES (@scope, @scopeId, @key, @value, @updatedAt)
      ON CONFLICT(scope, scope_id, preference_key) DO UPDATE SET value_json=@value, updated_at=@updatedAt`);
    const transaction = this.database.transaction((entries) =>
      entries.forEach(([key, value]) =>
        statement.run({ scope, scopeId, key, value: JSON.stringify(value), updatedAt: now }),
      ),
    );
    transaction(Object.entries(values));
    return this.getPreferences(scope, scopeId);
  }

  resetPreferences(scope, scopeId) {
    this.database
      .prepare('DELETE FROM preferences WHERE scope = ? AND scope_id = ?')
      .run(scope, scopeId);
    return {};
  }

  close() {
    this.database.close();
  }
}

module.exports = { PersistenceStore };
