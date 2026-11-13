class SchemaMigrator {
  constructor(database) {
    this.database = database;
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
      const schemaVersion = this.database.prepare('SELECT version FROM schema_meta').get().version;
      if (schemaVersion < 11) {
        this.database.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_stickers_account_sticker
            ON stickers(account_id, sticker_id);
          CREATE TABLE IF NOT EXISTS sticker_packs (
            pack_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            source TEXT NOT NULL CHECK (source IN ('created')),
            status TEXT NOT NULL CHECK (status IN ('installed')),
            name TEXT NOT NULL,
            description TEXT,
            revision INTEGER NOT NULL CHECK (revision > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (account_id, pack_id),
            FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
          );
          CREATE TABLE IF NOT EXISTS sticker_pack_items (
            account_id TEXT NOT NULL,
            pack_id TEXT NOT NULL,
            sticker_id TEXT NOT NULL,
            position INTEGER NOT NULL CHECK (position >= 0),
            PRIMARY KEY (account_id, pack_id, sticker_id),
            UNIQUE (account_id, pack_id, position),
            FOREIGN KEY (account_id, pack_id) REFERENCES sticker_packs(account_id, pack_id) ON DELETE CASCADE,
            FOREIGN KEY (account_id, sticker_id) REFERENCES stickers(account_id, sticker_id) ON DELETE RESTRICT
          );
          CREATE INDEX IF NOT EXISTS idx_sticker_pack_items_sticker
            ON sticker_pack_items(account_id, sticker_id);
          CREATE TABLE IF NOT EXISTS sticker_drafts (
            draft_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            base_pack_id TEXT,
            base_pack_revision INTEGER,
            status TEXT NOT NULL CHECK (status IN ('editing', 'validating', 'ready', 'failed', 'saved', 'discarded')),
            name TEXT NOT NULL,
            description TEXT,
            revision INTEGER NOT NULL CHECK (revision > 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (account_id, draft_id),
            FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_sticker_drafts_account_status
            ON sticker_drafts(account_id, status, updated_at);
          CREATE TABLE IF NOT EXISTS sticker_draft_items (
            account_id TEXT NOT NULL,
            draft_id TEXT NOT NULL,
            sticker_id TEXT NOT NULL,
            position INTEGER NOT NULL CHECK (position >= 0),
            PRIMARY KEY (account_id, draft_id, sticker_id),
            UNIQUE (account_id, draft_id, position),
            FOREIGN KEY (account_id, draft_id) REFERENCES sticker_drafts(account_id, draft_id) ON DELETE CASCADE,
            FOREIGN KEY (account_id, sticker_id) REFERENCES stickers(account_id, sticker_id) ON DELETE RESTRICT
          );
          CREATE INDEX IF NOT EXISTS idx_sticker_draft_items_sticker
            ON sticker_draft_items(account_id, sticker_id);
          UPDATE schema_meta SET version = 11;
        `);
      }
      const currentSchemaVersion = this.database
        .prepare('SELECT version FROM schema_meta')
        .get().version;
      if (currentSchemaVersion < 12) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS sticker_message_refs (
            ref_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            client_message_id TEXT NOT NULL,
            stanza_id TEXT,
            origin_id TEXT,
            direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
            sender_jid TEXT NOT NULL,
            source_sticker_id TEXT,
            preview_sticker_id TEXT NOT NULL,
            name TEXT,
            alt_text TEXT,
            fallback_text TEXT,
            mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
            size_bytes TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            hash_algorithm TEXT NOT NULL CHECK (hash_algorithm IN ('sha-256')),
            hash_value TEXT NOT NULL,
            remote_url TEXT,
            storage_provider_id TEXT,
            storage_origin TEXT,
            local_asset_id TEXT,
            storage_key TEXT,
            transport_status TEXT NOT NULL CHECK (transport_status IN ('queued', 'uploading', 'sending', 'sent', 'failed')),
            availability TEXT NOT NULL CHECK (availability IN ('available', 'missing', 'invalid', 'blocked')),
            error_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (account_id, client_message_id),
            FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS idx_sticker_messages_account_conversation_created
            ON sticker_message_refs(account_id, conversation_id, created_at, ref_id);
          CREATE INDEX IF NOT EXISTS idx_sticker_messages_asset
            ON sticker_message_refs(account_id, local_asset_id);
          UPDATE schema_meta SET version = 12;
        `);
      }
      const fallbackColumns = this.database
        .prepare('PRAGMA table_info(sticker_message_refs)')
        .all();
      if (
        fallbackColumns.length &&
        !fallbackColumns.some((column) => column.name === 'fallback_text')
      )
        this.database.exec('ALTER TABLE sticker_message_refs ADD COLUMN fallback_text TEXT');
      const preMigrationProviderColumns = this.database
        .prepare('PRAGMA table_info(sticker_message_refs)')
        .all();
      if (
        preMigrationProviderColumns.length &&
        !preMigrationProviderColumns.some((column) => column.name === 'storage_provider_id')
      )
        this.database.exec('ALTER TABLE sticker_message_refs ADD COLUMN storage_provider_id TEXT');
      if (
        preMigrationProviderColumns.length &&
        !preMigrationProviderColumns.some((column) => column.name === 'storage_origin')
      )
        this.database.exec('ALTER TABLE sticker_message_refs ADD COLUMN storage_origin TEXT');
      const schemaAfterStickerMessages = this.database
        .prepare('SELECT version FROM schema_meta')
        .get().version;
      if (schemaAfterStickerMessages < 13) {
        this.database.exec(`
          CREATE TABLE sticker_message_refs_v13 (
            ref_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            client_message_id TEXT NOT NULL,
            stanza_id TEXT,
            origin_id TEXT,
            direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
            sender_jid TEXT NOT NULL,
            source_sticker_id TEXT,
            preview_sticker_id TEXT NOT NULL,
            name TEXT,
            alt_text TEXT,
            fallback_text TEXT,
            mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg')),
            size_bytes TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            hash_algorithm TEXT NOT NULL CHECK (hash_algorithm IN ('sha-256')),
            hash_value TEXT NOT NULL,
            remote_url TEXT,
            storage_provider_id TEXT,
            storage_origin TEXT,
            local_asset_id TEXT,
            storage_key TEXT,
            transport_status TEXT NOT NULL CHECK (transport_status IN ('queued', 'uploading', 'sending', 'sent', 'failed')),
            availability TEXT NOT NULL CHECK (availability IN ('available', 'missing', 'invalid', 'blocked')),
            error_code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (account_id, direction, conversation_id, client_message_id, sender_jid),
            FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
          );
          INSERT INTO sticker_message_refs_v13(
            ref_id, account_id, conversation_id, client_message_id, stanza_id, origin_id, direction,
            sender_jid, source_sticker_id, preview_sticker_id, name, alt_text, fallback_text, mime_type,
            size_bytes, width, height, hash_algorithm, hash_value, remote_url, storage_provider_id, storage_origin, local_asset_id, storage_key,
            transport_status, availability, error_code, created_at, updated_at
          ) SELECT
            ref_id, account_id, conversation_id, client_message_id, stanza_id, origin_id, direction,
            sender_jid, source_sticker_id, preview_sticker_id, name, alt_text, fallback_text, mime_type,
            size_bytes, width, height, hash_algorithm, hash_value, remote_url, storage_provider_id, storage_origin, local_asset_id, storage_key,
            transport_status, availability, error_code, created_at, updated_at
          FROM sticker_message_refs;
          DROP INDEX IF EXISTS idx_sticker_messages_account_conversation_created;
          DROP INDEX IF EXISTS idx_sticker_messages_asset;
          DROP TABLE sticker_message_refs;
          ALTER TABLE sticker_message_refs_v13 RENAME TO sticker_message_refs;
          CREATE INDEX idx_sticker_messages_account_conversation_created
            ON sticker_message_refs(account_id, conversation_id, created_at, ref_id);
          CREATE INDEX idx_sticker_messages_asset
            ON sticker_message_refs(account_id, local_asset_id);
          UPDATE schema_meta SET version = 13;
        `);
      }
      const stickerMessageColumns = this.database
        .prepare('PRAGMA table_info(sticker_message_refs)')
        .all();
      if (
        stickerMessageColumns.length &&
        !stickerMessageColumns.some((column) => column.name === 'fallback_text')
      )
        this.database.exec('ALTER TABLE sticker_message_refs ADD COLUMN fallback_text TEXT');
      const providerColumns = this.database
        .prepare('PRAGMA table_info(sticker_message_refs)')
        .all();
      if (
        providerColumns.length &&
        !providerColumns.some((column) => column.name === 'storage_provider_id')
      )
        this.database.exec('ALTER TABLE sticker_message_refs ADD COLUMN storage_provider_id TEXT');
      if (
        providerColumns.length &&
        !providerColumns.some((column) => column.name === 'storage_origin')
      )
        this.database.exec('ALTER TABLE sticker_message_refs ADD COLUMN storage_origin TEXT');
      this.database.prepare('UPDATE schema_meta SET version = 14 WHERE version < 14').run();
      const messageIdentifierColumns = this.database.prepare('PRAGMA table_info(messages)').all();
      if (!messageIdentifierColumns.some((column) => column.name === 'message_id'))
        this.database.exec('ALTER TABLE messages ADD COLUMN message_id TEXT');
      if (!messageIdentifierColumns.some((column) => column.name === 'origin_id'))
        this.database.exec('ALTER TABLE messages ADD COLUMN origin_id TEXT');
      if (!messageIdentifierColumns.some((column) => column.name === 'stanza_ids_json'))
        this.database.exec('ALTER TABLE messages ADD COLUMN stanza_ids_json TEXT');
      if (!messageIdentifierColumns.some((column) => column.name === 'reply_to_json'))
        this.database.exec('ALTER TABLE messages ADD COLUMN reply_to_json TEXT');
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS message_reactions (
          account_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('direct', 'muc')),
          target_key TEXT NOT NULL,
          actor_key TEXT NOT NULL,
          target_json TEXT NOT NULL,
          emojis_json TEXT NOT NULL,
          session_generation INTEGER,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (account_id, conversation_id, source, target_key, actor_key),
          FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_message_reactions_target
          ON message_reactions(account_id, conversation_id, source, target_key);
        UPDATE schema_meta SET version = 15 WHERE version < 15;
      `);
    });
    migrate();
  }
}

module.exports = { SchemaMigrator };
