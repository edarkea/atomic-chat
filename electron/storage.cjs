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
      const messageColumns = this.database.prepare('PRAGMA table_info(messages)').all();
      if (!messageColumns.some((column) => column.name === 'classification'))
        this.database.exec(
          "ALTER TABLE messages ADD COLUMN classification TEXT NOT NULL DEFAULT 'direct'",
        );
      this.database.prepare('UPDATE schema_meta SET version = 7').run();
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS media_assets (
          media_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          transfer_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
          sender_jid TEXT NOT NULL,
          original_name TEXT NOT NULL,
          mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
          size_bytes TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          availability TEXT NOT NULL CHECK (availability IN ('available', 'missing', 'invalid')),
          storage_key TEXT,
          UNIQUE (account_id, transfer_id),
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_media_account_conversation_created
          ON media_assets(account_id, conversation_id, created_at, media_id);
        CREATE INDEX IF NOT EXISTS idx_media_account_transfer
          ON media_assets(account_id, transfer_id);
      `);
      this.database.prepare('UPDATE schema_meta SET version = 8').run();
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS file_assets (
          file_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          transfer_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
          sender_jid TEXT NOT NULL,
          original_name TEXT NOT NULL,
          size_bytes TEXT NOT NULL,
          mime_type TEXT,
          local_path TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('completed')),
          availability TEXT NOT NULL CHECK (availability IN ('unchecked', 'available', 'missing', 'changed', 'blocked')),
          metadata_dev TEXT,
          metadata_ino TEXT,
          metadata_size TEXT NOT NULL,
          metadata_mtime_ms TEXT NOT NULL,
          metadata_birthtime_ms TEXT NOT NULL,
          UNIQUE (account_id, transfer_id),
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_file_assets_account_conversation_created
          ON file_assets(account_id, conversation_id, created_at, file_id);
        CREATE INDEX IF NOT EXISTS idx_file_assets_account_transfer
          ON file_assets(account_id, transfer_id);
      `);
      this.database.prepare('UPDATE schema_meta SET version = 9').run();
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS sticker_assets (
          asset_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          hash_algorithm TEXT NOT NULL CHECK (hash_algorithm IN ('sha-256')),
          hash_value TEXT NOT NULL,
          mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
          size_bytes TEXT NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          storage_key TEXT NOT NULL,
          availability TEXT NOT NULL CHECK (availability IN ('pending', 'available', 'missing', 'invalid', 'blocked')),
          orphaned_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (account_id, hash_algorithm, hash_value),
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS stickers (
          sticker_id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          pack_id TEXT,
          name TEXT,
          alt_text TEXT,
          sort_key TEXT NOT NULL,
          availability TEXT NOT NULL CHECK (availability IN ('pending', 'available', 'missing', 'invalid', 'blocked')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
          FOREIGN KEY (asset_id) REFERENCES sticker_assets(asset_id) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_sticker_assets_account ON sticker_assets(account_id, created_at, asset_id);
        CREATE INDEX IF NOT EXISTS idx_sticker_assets_hash ON sticker_assets(account_id, hash_algorithm, hash_value);
        CREATE INDEX IF NOT EXISTS idx_stickers_account ON stickers(account_id, sort_key, sticker_id);
        CREATE INDEX IF NOT EXISTS idx_stickers_asset ON stickers(asset_id);
      `);
      this.database.prepare('UPDATE schema_meta SET version = 10').run();
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
    const classification = message.classification || 'direct';
    if (!['direct', 'broadcast'].includes(classification)) throw new Error('INVALID_INPUT');
    this.database
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at, classification)
      VALUES (@id, @accountId, @conversationId, @clientMessageId, @senderJid, @body, @status, @createdAt, @classification)
      ON CONFLICT(account_id, client_message_id) DO UPDATE SET status=@status, body=@body, classification=@classification`,
      )
      .run({ ...message, classification, body: JSON.stringify(message.body) });
  }

  listMessages(accountId, conversationId) {
    return this.database
      .prepare(
        `SELECT id, conversation_id AS conversationId, client_message_id AS clientMessageId,
      sender_jid AS senderJid, body, status, created_at AS createdAt, classification
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
      sender_jid AS senderJid, body, status, created_at AS createdAt, classification FROM messages
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

  upsertMedia(record, storageKey = null) {
    if (!record?.accountId || !record?.mediaId || !record?.transferId)
      throw new Error('INVALID_INPUT');
    this.database
      .prepare(
        `INSERT INTO media_assets(
          media_id, account_id, transfer_id, conversation_id, direction, sender_jid,
          original_name, mime_type, size_bytes, width, height, created_at, availability, storage_key
        ) VALUES (
          @mediaId, @accountId, @transferId, @conversationId, @direction, @senderJid,
          @originalName, @mimeType, @sizeBytes, @width, @height, @createdAt, @availability, @storageKey
        )
        ON CONFLICT(account_id, transfer_id) DO UPDATE SET
          media_id = excluded.media_id,
          conversation_id = excluded.conversation_id,
          direction = excluded.direction,
          sender_jid = excluded.sender_jid,
          original_name = excluded.original_name,
          mime_type = excluded.mime_type,
          size_bytes = excluded.size_bytes,
          width = excluded.width,
          height = excluded.height,
          created_at = excluded.created_at,
          availability = excluded.availability,
          storage_key = excluded.storage_key`,
      )
      .run({ ...record, storageKey });
    return this.getMedia(record.accountId, record.mediaId);
  }

  getMedia(accountId, mediaId) {
    const row = this.database
      .prepare(
        `SELECT media_id AS mediaId, account_id AS accountId, transfer_id AS transferId,
          conversation_id AS conversationId, direction, sender_jid AS senderJid,
          original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes,
          width, height, created_at AS createdAt, availability, storage_key AS storageKey
         FROM media_assets WHERE account_id = ? AND media_id = ?`,
      )
      .get(accountId, mediaId);
    return row || null;
  }

  getMediaByTransfer(accountId, transferId) {
    const row = this.database
      .prepare(
        `SELECT media_id AS mediaId, account_id AS accountId, transfer_id AS transferId,
          conversation_id AS conversationId, direction, sender_jid AS senderJid,
          original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes,
          width, height, created_at AS createdAt, availability, storage_key AS storageKey
         FROM media_assets WHERE account_id = ? AND transfer_id = ?`,
      )
      .get(accountId, transferId);
    return row || null;
  }

  listMedia(accountId, conversationId, limit = 100) {
    const values = [accountId];
    const predicate = conversationId ? ' AND conversation_id = ?' : '';
    if (conversationId) values.push(conversationId);
    return this.database
      .prepare(
        `SELECT media_id AS mediaId, account_id AS accountId, transfer_id AS transferId,
          conversation_id AS conversationId, direction, sender_jid AS senderJid,
          original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes,
          width, height, created_at AS createdAt, availability, storage_key AS storageKey
         FROM media_assets WHERE account_id = ?${predicate}
         ORDER BY created_at ASC, media_id ASC LIMIT ?`,
      )
      .all(...values, limit);
  }

  listAllMedia() {
    return this.database
      .prepare(
        `SELECT media_id AS mediaId, account_id AS accountId, transfer_id AS transferId,
          conversation_id AS conversationId, direction, sender_jid AS senderJid,
          original_name AS originalName, mime_type AS mimeType, size_bytes AS sizeBytes,
          width, height, created_at AS createdAt, availability, storage_key AS storageKey
         FROM media_assets`,
      )
      .all();
  }

  updateMediaAvailability(accountId, mediaId, availability) {
    if (!['available', 'missing', 'invalid'].includes(availability)) throw new Error('INVALID_INPUT');
    this.database
      .prepare('UPDATE media_assets SET availability = ? WHERE account_id = ? AND media_id = ?')
      .run(availability, accountId, mediaId);
  }

  upsertFileAsset(record) {
    if (
      !record?.fileId ||
      !record.accountId ||
      !record.conversationId ||
      !record.transferId ||
      !record.localPath ||
      !record.metadata
    )
      throw new Error('INVALID_INPUT');
    this.database
      .prepare(
        `INSERT INTO file_assets(
          file_id, account_id, conversation_id, transfer_id, direction, sender_jid,
          original_name, size_bytes, mime_type, local_path, created_at, status,
          availability, metadata_dev, metadata_ino, metadata_size,
          metadata_mtime_ms, metadata_birthtime_ms
        ) VALUES (
          @fileId, @accountId, @conversationId, @transferId, @direction, @senderJid,
          @originalName, @sizeBytes, @mimeType, @localPath, @createdAt, @status,
          @availability, @metadataDev, @metadataIno, @metadataSize,
          @metadataMtimeMs, @metadataBirthtimeMs
        )
        ON CONFLICT(account_id, transfer_id) DO UPDATE SET
          file_id = excluded.file_id,
          conversation_id = excluded.conversation_id,
          direction = excluded.direction,
          sender_jid = excluded.sender_jid,
          original_name = excluded.original_name,
          size_bytes = excluded.size_bytes,
          mime_type = excluded.mime_type,
          local_path = excluded.local_path,
          created_at = excluded.created_at,
          status = excluded.status,
          availability = excluded.availability,
          metadata_dev = excluded.metadata_dev,
          metadata_ino = excluded.metadata_ino,
          metadata_size = excluded.metadata_size,
          metadata_mtime_ms = excluded.metadata_mtime_ms,
          metadata_birthtime_ms = excluded.metadata_birthtime_ms`,
      )
      .run({
        fileId: record.fileId,
        accountId: record.accountId,
        conversationId: record.conversationId,
        transferId: record.transferId,
        direction: record.direction,
        senderJid: record.senderJid,
        originalName: record.originalName,
        sizeBytes: record.sizeBytes,
        mimeType: record.mimeType || null,
        localPath: record.localPath,
        createdAt: record.createdAt,
        status: 'completed',
        availability: record.availability,
        metadataDev: record.metadata.dev,
        metadataIno: record.metadata.ino,
        metadataSize: record.metadata.size,
        metadataMtimeMs: record.metadata.mtimeMs,
        metadataBirthtimeMs: record.metadata.birthtimeMs,
      });
    return this.getFileAsset(record.accountId, record.fileId);
  }

  getFileAsset(accountId, fileId) {
    return this.database
      .prepare(
        `SELECT file_id AS fileId, account_id AS accountId, conversation_id AS conversationId,
          transfer_id AS transferId, direction, sender_jid AS senderJid,
          original_name AS originalName, size_bytes AS sizeBytes, mime_type AS mimeType,
          local_path AS localPath, created_at AS createdAt, status, availability,
          metadata_dev AS metadataDev, metadata_ino AS metadataIno,
          metadata_size AS metadataSize, metadata_mtime_ms AS metadataMtimeMs,
          metadata_birthtime_ms AS metadataBirthtimeMs
         FROM file_assets WHERE account_id = ? AND file_id = ?`,
      )
      .get(accountId, fileId);
  }

  updateFileAssetAvailability(accountId, fileId, availability) {
    if (!['unchecked', 'available', 'missing', 'changed', 'blocked'].includes(availability))
      throw new Error('INVALID_INPUT');
    this.database
      .prepare('UPDATE file_assets SET availability = ? WHERE account_id = ? AND file_id = ?')
      .run(availability, accountId, fileId);
  }

  getStickerAssetByHash(accountId, hashValue) {
    return this.database.prepare(
      `SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm,
        hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height,
        storage_key AS storageKey, availability, orphaned_at AS orphanedAt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_assets WHERE account_id = ? AND hash_algorithm = 'sha-256' AND hash_value = ?`,
    ).get(accountId, hashValue) || null;
  }

  getStickerAsset(accountId, assetId) {
    return this.database.prepare(
      `SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm,
        hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height,
        storage_key AS storageKey, availability, orphaned_at AS orphanedAt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_assets WHERE account_id = ? AND asset_id = ?`,
    ).get(accountId, assetId) || null;
  }

  countStickers(accountId) {
    return this.database.prepare('SELECT COUNT(*) AS count FROM stickers WHERE account_id = ?').get(accountId).count;
  }

  sumStickerStorage(accountId) {
    return this.database.prepare(
      `SELECT COALESCE(SUM(CAST(size_bytes AS INTEGER)), 0) AS total
       FROM sticker_assets WHERE account_id = ?`,
    ).get(accountId).total;
  }

  insertStickerAsset(record) {
    this.database.prepare(
      `INSERT INTO sticker_assets(
        asset_id, account_id, hash_algorithm, hash_value, mime_type, size_bytes, width, height,
        storage_key, availability, orphaned_at, created_at, updated_at
      ) VALUES (@assetId, @accountId, 'sha-256', @hashValue, @mimeType, @sizeBytes, @width, @height,
        @storageKey, @availability, NULL, @createdAt, @updatedAt)`,
    ).run(record);
    return this.getStickerAsset(record.accountId, record.assetId);
  }

  insertSticker(record) {
    this.database.prepare(
      `INSERT INTO stickers(
        sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
      ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, @availability, @createdAt, @updatedAt)`,
    ).run({ ...record, name: record.name || null, altText: record.altText || null });
    return this.getSticker(record.accountId, record.stickerId);
  }

  insertStickerReference(record) {
    const transaction = this.database.transaction(() => {
      this.database.prepare('UPDATE sticker_assets SET orphaned_at = NULL, updated_at = ? WHERE account_id = ? AND asset_id = ?')
        .run(record.updatedAt, record.accountId, record.assetId);
      this.database.prepare(
        `INSERT INTO stickers(
          sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
        ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, @availability, @createdAt, @updatedAt)`,
      ).run({ ...record, name: record.name || null, altText: record.altText || null });
    });
    transaction();
    return this.getSticker(record.accountId, record.stickerId);
  }

  clearStickerAssetOrphaned(accountId, assetId) {
    this.database.prepare('UPDATE sticker_assets SET orphaned_at = NULL, updated_at = ? WHERE account_id = ? AND asset_id = ?')
      .run(new Date().toISOString(), accountId, assetId);
  }

  hasStickerReferences(assetId) {
    return this.database.prepare('SELECT 1 FROM stickers WHERE asset_id = ? LIMIT 1').get(assetId) !== undefined;
  }

  createStickerAssetAndSticker(asset, sticker) {
    const transaction = this.database.transaction(() => {
      this.database.prepare(
        `INSERT INTO sticker_assets(
          asset_id, account_id, hash_algorithm, hash_value, mime_type, size_bytes, width, height,
          storage_key, availability, orphaned_at, created_at, updated_at
        ) VALUES (@assetId, @accountId, 'sha-256', @hashValue, @mimeType, @sizeBytes, @width, @height,
          @storageKey, @availability, NULL, @createdAt, @updatedAt)`,
      ).run(asset);
      this.database.prepare(
        `INSERT INTO stickers(
          sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
        ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, @availability, @createdAt, @updatedAt)`,
      ).run({ ...sticker, name: sticker.name || null, altText: sticker.altText || null });
    });
    transaction();
    return {
      asset: this.getStickerAsset(asset.accountId, asset.assetId),
      sticker: this.getSticker(sticker.accountId, sticker.stickerId),
    };
  }

  recoverStickerAssetAndSticker(asset, sticker) {
    const transaction = this.database.transaction(() => {
      this.database.prepare(
        `UPDATE sticker_assets SET mime_type = @mimeType, size_bytes = @sizeBytes, width = @width,
          height = @height, storage_key = @storageKey, availability = 'available', orphaned_at = NULL,
          updated_at = @updatedAt WHERE account_id = @accountId AND asset_id = @assetId`,
      ).run(asset);
      this.database.prepare(
        `INSERT INTO stickers(
          sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
        ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, 'available', @createdAt, @updatedAt)`,
      ).run({ ...sticker, name: sticker.name || null, altText: sticker.altText || null });
    });
    transaction();
    return { asset: this.getStickerAsset(asset.accountId, asset.assetId), sticker: this.getSticker(sticker.accountId, sticker.stickerId) };
  }

  getSticker(accountId, stickerId) {
    return this.database.prepare(
      `SELECT sticker_id AS stickerId, account_id AS accountId, asset_id AS assetId,
        name, alt_text AS altText, sort_key AS sortKey, availability, created_at AS createdAt, updated_at AS updatedAt
       FROM stickers WHERE account_id = ? AND sticker_id = ?`,
    ).get(accountId, stickerId) || null;
  }

  listStickers(accountId, query = '', limit = 250) {
    const normalized = `%${String(query).trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    return this.database.prepare(
      `SELECT sticker_id AS stickerId, account_id AS accountId, asset_id AS assetId,
        name, alt_text AS altText, sort_key AS sortKey, availability, created_at AS createdAt, updated_at AS updatedAt
       FROM stickers WHERE account_id = ? AND (COALESCE(name, '') LIKE ? ESCAPE '\\' OR COALESCE(alt_text, '') LIKE ? ESCAPE '\\')
       ORDER BY sort_key ASC, sticker_id ASC LIMIT ?`,
    ).all(accountId, normalized, normalized, limit);
  }

  deleteSticker(accountId, stickerId) {
    const sticker = this.getSticker(accountId, stickerId);
    if (!sticker) return null;
    this.database.prepare('DELETE FROM stickers WHERE account_id = ? AND sticker_id = ?').run(accountId, stickerId);
    const references = this.database.prepare('SELECT COUNT(*) AS count FROM stickers WHERE asset_id = ?').get(sticker.assetId).count;
    if (references === 0) {
      const now = new Date().toISOString();
      this.database.prepare('UPDATE sticker_assets SET orphaned_at = ?, updated_at = ? WHERE account_id = ? AND asset_id = ?')
        .run(now, now, accountId, sticker.assetId);
    }
    return sticker;
  }

  markStickerAssetAvailability(accountId, assetId, availability) {
    if (!['pending', 'available', 'missing', 'invalid', 'blocked'].includes(availability)) throw new Error('INVALID_INPUT');
    this.database.prepare('UPDATE sticker_assets SET availability = ?, updated_at = ? WHERE account_id = ? AND asset_id = ?')
      .run(availability, new Date().toISOString(), accountId, assetId);
  }

  listStickerAssets(accountId) {
    const query = accountId
      ? 'SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm, hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height, storage_key AS storageKey, availability, orphaned_at AS orphanedAt, created_at AS createdAt, updated_at AS updatedAt FROM sticker_assets WHERE account_id = ?'
      : 'SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm, hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height, storage_key AS storageKey, availability, orphaned_at AS orphanedAt, created_at AS createdAt, updated_at AS updatedAt FROM sticker_assets';
    return accountId ? this.database.prepare(query).all(accountId) : this.database.prepare(query).all();
  }

  deleteStickerAsset(accountId, assetId) {
    this.database.prepare('DELETE FROM sticker_assets WHERE account_id = ? AND asset_id = ? AND NOT EXISTS (SELECT 1 FROM stickers WHERE asset_id = ?)')
      .run(accountId, assetId, assetId);
  }

  listTimelinePage(accountId, conversationId, limit, direction, cursor) {
    const values = [accountId, conversationId, accountId, conversationId, accountId, conversationId];
    let predicate = '';
    let order = 'ORDER BY sort_at DESC, id DESC';
    if (cursor) {
      if (direction === 'older') {
        predicate = ' AND (sort_at < ? OR (sort_at = ? AND id < ?))';
        values.push(cursor.createdAt, cursor.createdAt, cursor.id);
      } else {
        predicate = ' AND (sort_at > ? OR (sort_at = ? AND id > ?))';
        values.push(cursor.createdAt, cursor.createdAt, cursor.id);
        order = 'ORDER BY sort_at ASC, id ASC';
      }
    }
    const rows = this.database
      .prepare(
        `SELECT * FROM (
          SELECT id, created_at AS sort_at, 'text' AS kind, account_id AS account_id,
            conversation_id AS conversation_id, client_message_id, sender_jid, body, status,
            classification, NULL AS transfer_id, NULL AS media_id, NULL AS direction,
            NULL AS original_name, NULL AS mime_type, NULL AS size_bytes, NULL AS width,
            NULL AS height, NULL AS availability
          FROM messages WHERE account_id = ? AND conversation_id = ?
          UNION ALL
          SELECT media_id AS id, created_at AS sort_at, 'image' AS kind, account_id,
            conversation_id, NULL, sender_jid, NULL, NULL, NULL, transfer_id, media_id,
            direction, original_name, mime_type, size_bytes, width, height, availability
          FROM media_assets WHERE account_id = ? AND conversation_id = ?
          UNION ALL
          SELECT file_id AS id, created_at AS sort_at, 'file' AS kind, account_id,
            conversation_id, NULL, sender_jid, NULL, NULL, NULL, transfer_id, NULL,
            direction, original_name, mime_type, size_bytes, NULL, NULL, availability
          FROM file_assets WHERE account_id = ? AND conversation_id = ?
        ) AS timeline WHERE 1 = 1${predicate} ${order} LIMIT ?`,
      )
      .all(...values, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => {
      if (row.kind === 'text')
        return {
          kind: 'text',
          id: row.id,
          sortAt: row.sort_at,
          message: {
            id: row.id,
            accountId: row.account_id,
            conversationId: row.conversation_id,
            clientMessageId: row.client_message_id,
            senderJid: row.sender_jid,
            body: JSON.parse(row.body),
            status: row.status,
            createdAt: row.sort_at,
            classification: row.classification,
          },
        };
      if (row.kind === 'file')
        return {
          kind: 'file',
          id: row.id,
          sortAt: row.sort_at,
          file: {
            fileId: row.id,
            accountId: row.account_id,
            conversationId: row.conversation_id,
            transferId: row.transfer_id,
            direction: row.direction,
            senderJid: row.sender_jid,
            originalName: row.original_name,
            sizeBytes: row.size_bytes,
            ...(row.mime_type ? { mimeType: row.mime_type } : {}),
            createdAt: row.sort_at,
            availability: row.availability,
          },
        };
      return {
        kind: 'image',
        id: row.media_id,
        sortAt: row.sort_at,
        media: {
          mediaId: row.media_id,
          transferId: row.transfer_id,
          accountId: row.account_id,
          conversationId: row.conversation_id,
          direction: row.direction,
          senderJid: row.sender_jid,
          originalName: row.original_name,
          mimeType: row.mime_type,
          sizeBytes: row.size_bytes,
          width: row.width,
          height: row.height,
          createdAt: row.sort_at,
          availability: row.availability,
        },
      };
    });
    if (direction === 'older') page.reverse();
    return { items: page, hasMore };
  }

  listConversations(accountId) {
    return this.database
      .prepare(
        `SELECT account_id AS accountId, conversation_id AS jid,
      MAX(last_activity) AS lastActivity FROM (
        SELECT account_id, conversation_id, created_at AS last_activity FROM messages
        UNION ALL
        SELECT account_id, conversation_id, created_at AS last_activity FROM media_assets
        UNION ALL
        SELECT account_id, conversation_id, created_at AS last_activity FROM file_assets
      ) WHERE account_id = ?
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
