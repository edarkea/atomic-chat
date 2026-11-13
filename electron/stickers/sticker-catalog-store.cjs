const crypto = require('node:crypto');

function persistenceError(code, message = code) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

function savedStickerIdForMessage(refId) {
  return `sticker_saved_${crypto.createHash('sha256').update(refId).digest('hex').slice(0, 32)}`;
}

class StickerCatalogStore {
  constructor(database) {
    this.database = database;
  }

  getStickerAssetByHash(accountId, hashValue) {
    return (
      this.database
        .prepare(
          `SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm,
        hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height,
        storage_key AS storageKey, availability, orphaned_at AS orphanedAt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_assets WHERE account_id = ? AND hash_algorithm = 'sha-256' AND hash_value = ?`,
        )
        .get(accountId, hashValue) || null
    );
  }

  getStickerAsset(accountId, assetId) {
    return (
      this.database
        .prepare(
          `SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm,
        hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height,
        storage_key AS storageKey, availability, orphaned_at AS orphanedAt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_assets WHERE account_id = ? AND asset_id = ?`,
        )
        .get(accountId, assetId) || null
    );
  }

  countStickers(accountId) {
    return this.database
      .prepare('SELECT COUNT(*) AS count FROM stickers WHERE account_id = ?')
      .get(accountId).count;
  }

  sumStickerStorage(accountId) {
    return this.database
      .prepare(
        `SELECT COALESCE(SUM(CAST(size_bytes AS INTEGER)), 0) AS total
       FROM sticker_assets WHERE account_id = ?`,
      )
      .get(accountId).total;
  }

  insertStickerAsset(record) {
    this.database
      .prepare(
        `INSERT INTO sticker_assets(
        asset_id, account_id, hash_algorithm, hash_value, mime_type, size_bytes, width, height,
        storage_key, availability, orphaned_at, created_at, updated_at
      ) VALUES (@assetId, @accountId, 'sha-256', @hashValue, @mimeType, @sizeBytes, @width, @height,
        @storageKey, @availability, NULL, @createdAt, @updatedAt)`,
      )
      .run(record);
    return this.getStickerAsset(record.accountId, record.assetId);
  }

  insertSticker(record) {
    this.database
      .prepare(
        `INSERT INTO stickers(
        sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
      ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, @availability, @createdAt, @updatedAt)`,
      )
      .run({ ...record, name: record.name || null, altText: record.altText || null });
    return this.getSticker(record.accountId, record.stickerId);
  }

  insertStickerReference(record) {
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          'UPDATE sticker_assets SET orphaned_at = NULL, updated_at = ? WHERE account_id = ? AND asset_id = ?',
        )
        .run(record.updatedAt, record.accountId, record.assetId);
      this.database
        .prepare(
          `INSERT INTO stickers(
          sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
        ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, @availability, @createdAt, @updatedAt)`,
        )
        .run({ ...record, name: record.name || null, altText: record.altText || null });
    });
    transaction();
    return this.getSticker(record.accountId, record.stickerId);
  }

  clearStickerAssetOrphaned(accountId, assetId) {
    this.database
      .prepare(
        'UPDATE sticker_assets SET orphaned_at = NULL, updated_at = ? WHERE account_id = ? AND asset_id = ?',
      )
      .run(new Date().toISOString(), accountId, assetId);
  }

  hasStickerReferences(assetId) {
    return (
      this.database
        .prepare(
          `SELECT 1 FROM stickers WHERE asset_id = ?
       UNION ALL SELECT 1 FROM sticker_message_refs WHERE local_asset_id = ? LIMIT 1`,
        )
        .get(assetId, assetId) !== undefined
    );
  }
  createStickerAssetAndSticker(asset, sticker) {
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO sticker_assets(
          asset_id, account_id, hash_algorithm, hash_value, mime_type, size_bytes, width, height,
          storage_key, availability, orphaned_at, created_at, updated_at
        ) VALUES (@assetId, @accountId, 'sha-256', @hashValue, @mimeType, @sizeBytes, @width, @height,
          @storageKey, @availability, NULL, @createdAt, @updatedAt)`,
        )
        .run(asset);
      this.database
        .prepare(
          `INSERT INTO stickers(
          sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
        ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, @availability, @createdAt, @updatedAt)`,
        )
        .run({ ...sticker, name: sticker.name || null, altText: sticker.altText || null });
    });
    transaction();
    return {
      asset: this.getStickerAsset(asset.accountId, asset.assetId),
      sticker: this.getSticker(sticker.accountId, sticker.stickerId),
    };
  }

  recoverStickerAssetAndSticker(asset, sticker) {
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE sticker_assets SET mime_type = @mimeType, size_bytes = @sizeBytes, width = @width,
          height = @height, storage_key = @storageKey, availability = 'available', orphaned_at = NULL,
          updated_at = @updatedAt WHERE account_id = @accountId AND asset_id = @assetId`,
        )
        .run(asset);
      this.database
        .prepare(
          `INSERT INTO stickers(
          sticker_id, account_id, asset_id, pack_id, name, alt_text, sort_key, availability, created_at, updated_at
        ) VALUES (@stickerId, @accountId, @assetId, NULL, @name, @altText, @sortKey, 'available', @createdAt, @updatedAt)`,
        )
        .run({ ...sticker, name: sticker.name || null, altText: sticker.altText || null });
    });
    transaction();
    return {
      asset: this.getStickerAsset(asset.accountId, asset.assetId),
      sticker: this.getSticker(sticker.accountId, sticker.stickerId),
    };
  }

  getSticker(accountId, stickerId) {
    return (
      this.database
        .prepare(
          `SELECT sticker_id AS stickerId, account_id AS accountId, asset_id AS assetId,
        name, alt_text AS altText, sort_key AS sortKey, availability, created_at AS createdAt, updated_at AS updatedAt
       FROM stickers WHERE account_id = ? AND sticker_id = ?`,
        )
        .get(accountId, stickerId) || null
    );
  }

  getStickerByHash(accountId, hashValue) {
    return (
      this.database
        .prepare(
          `SELECT s.sticker_id AS stickerId, s.account_id AS accountId, s.asset_id AS assetId,
        s.name, s.alt_text AS altText, s.sort_key AS sortKey, s.availability,
        s.created_at AS createdAt, s.updated_at AS updatedAt
       FROM stickers s JOIN sticker_assets a
         ON a.account_id = s.account_id AND a.asset_id = s.asset_id
       WHERE s.account_id = ? AND s.availability = 'available'
         AND a.availability = 'available' AND a.hash_algorithm = 'sha-256' AND a.hash_value = ?
       ORDER BY s.sort_key ASC, s.sticker_id ASC LIMIT 1`,
        )
        .get(accountId, hashValue) || null
    );
  }

  getSavedStickerIdForMessage(accountId, refId) {
    const stickerId = savedStickerIdForMessage(refId);
    const exact = this.getSticker(accountId, stickerId);
    if (exact) return exact.stickerId;
    const message = this.database
      .prepare(
        'SELECT hash_value AS hashValue FROM sticker_message_refs WHERE account_id = ? AND ref_id = ?',
      )
      .get(accountId, refId);
    return message ? this.getStickerByHash(accountId, message.hashValue)?.stickerId : undefined;
  }

  listStickers(accountId, query = '', limit = 250, packId) {
    const normalized = `%${String(query).trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    if (packId) {
      return this.database
        .prepare(
          `SELECT s.sticker_id AS stickerId, s.account_id AS accountId, s.asset_id AS assetId,
          s.name, s.alt_text AS altText, s.sort_key AS sortKey, s.availability,
          s.created_at AS createdAt, s.updated_at AS updatedAt
         FROM stickers s JOIN sticker_pack_items i
           ON i.account_id = s.account_id AND i.sticker_id = s.sticker_id
         WHERE s.account_id = ? AND i.pack_id = ?
           AND (COALESCE(s.name, '') LIKE ? ESCAPE '\\' OR COALESCE(s.alt_text, '') LIKE ? ESCAPE '\\')
         ORDER BY i.position ASC LIMIT ?`,
        )
        .all(accountId, packId, normalized, normalized, limit);
    }
    return this.database
      .prepare(
        `SELECT sticker_id AS stickerId, account_id AS accountId, asset_id AS assetId,
        name, alt_text AS altText, sort_key AS sortKey, availability, created_at AS createdAt, updated_at AS updatedAt
       FROM stickers WHERE account_id = ? AND (COALESCE(name, '') LIKE ? ESCAPE '\\' OR COALESCE(alt_text, '') LIKE ? ESCAPE '\\')
       ORDER BY sort_key ASC, sticker_id ASC LIMIT ?`,
      )
      .all(accountId, normalized, normalized, limit);
  }

  deleteSticker(accountId, stickerId) {
    const sticker = this.getSticker(accountId, stickerId);
    if (!sticker) return null;
    if (
      this.hasStickerPackReferences(accountId, stickerId) ||
      this.hasStickerDraftReferences(accountId, stickerId)
    )
      throw persistenceError('CONFLICT', 'el sticker pertenece a un paquete o borrador');
    this.database
      .prepare('DELETE FROM stickers WHERE account_id = ? AND sticker_id = ?')
      .run(accountId, stickerId);
    const references = this.database
      .prepare('SELECT COUNT(*) AS count FROM stickers WHERE asset_id = ?')
      .get(sticker.assetId).count;
    if (references === 0) {
      const now = new Date().toISOString();
      this.database
        .prepare(
          'UPDATE sticker_assets SET orphaned_at = ?, updated_at = ? WHERE account_id = ? AND asset_id = ?',
        )
        .run(now, now, accountId, sticker.assetId);
    }
    return sticker;
  }

  markStickerAssetAvailability(accountId, assetId, availability) {
    if (!['pending', 'available', 'missing', 'invalid', 'blocked'].includes(availability))
      throw new Error('INVALID_INPUT');
    this.database
      .prepare(
        'UPDATE sticker_assets SET availability = ?, updated_at = ? WHERE account_id = ? AND asset_id = ?',
      )
      .run(availability, new Date().toISOString(), accountId, assetId);
  }

  updateStickerAsset(record) {
    this.database
      .prepare(
        `UPDATE sticker_assets SET mime_type = ?, size_bytes = ?, width = ?, height = ?, storage_key = ?,
         availability = 'available', orphaned_at = NULL, updated_at = ?
       WHERE account_id = ? AND asset_id = ?`,
      )
      .run(
        record.mimeType,
        String(record.sizeBytes),
        record.width,
        record.height,
        record.storageKey,
        record.updatedAt,
        record.accountId,
        record.assetId,
      );
    return this.getStickerAsset(record.accountId, record.assetId);
  }

  listStickerAssets(accountId) {
    const query = accountId
      ? 'SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm, hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height, storage_key AS storageKey, availability, orphaned_at AS orphanedAt, created_at AS createdAt, updated_at AS updatedAt FROM sticker_assets WHERE account_id = ?'
      : 'SELECT asset_id AS assetId, account_id AS accountId, hash_algorithm AS hashAlgorithm, hash_value AS hashValue, mime_type AS mimeType, size_bytes AS sizeBytes, width, height, storage_key AS storageKey, availability, orphaned_at AS orphanedAt, created_at AS createdAt, updated_at AS updatedAt FROM sticker_assets';
    return accountId
      ? this.database.prepare(query).all(accountId)
      : this.database.prepare(query).all();
  }

  deleteStickerAsset(accountId, assetId) {
    this.database
      .prepare(
        'DELETE FROM sticker_assets WHERE account_id = ? AND asset_id = ? AND NOT EXISTS (SELECT 1 FROM stickers WHERE asset_id = ?)',
      )
      .run(accountId, assetId, assetId);
  }

  hasStickerPackReferences(accountId, stickerId) {
    return (
      this.database
        .prepare('SELECT 1 FROM sticker_pack_items WHERE account_id = ? AND sticker_id = ? LIMIT 1')
        .get(accountId, stickerId) !== undefined
    );
  }

  hasStickerDraftReferences(accountId, stickerId) {
    return (
      this.database
        .prepare(
          `SELECT 1 FROM sticker_draft_items i JOIN sticker_drafts d
         ON d.account_id = i.account_id AND d.draft_id = i.draft_id
       WHERE i.account_id = ? AND i.sticker_id = ? AND d.status NOT IN ('discarded', 'saved') LIMIT 1`,
        )
        .get(accountId, stickerId) !== undefined
    );
  }
}

module.exports = { StickerCatalogStore };
