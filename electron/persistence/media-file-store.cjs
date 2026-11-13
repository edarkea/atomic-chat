class MediaFileStore {
  constructor(database) {
    this.database = database;
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
    if (!['available', 'missing', 'invalid'].includes(availability))
      throw new Error('INVALID_INPUT');
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
}

module.exports = { MediaFileStore };
