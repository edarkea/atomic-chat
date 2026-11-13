function persistenceError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function previewStickerIdForMessage(refId) {
  return `message:${refId}`;
}

class StickerMessagePersistence {
  constructor(database, getSavedStickerId) {
    this.database = database;
    this.getSavedStickerId = getSavedStickerId;
  }

  stickerMessageFromRow(row) {
    if (!row) return null;
    const savedStickerId = this.getSavedStickerId(row.accountId, row.refId);
    return {
      refId: row.refId,
      previewStickerId: previewStickerIdForMessage(row.refId),
      accountId: row.accountId,
      conversationId: row.conversationId,
      clientMessageId: row.clientMessageId,
      ...(row.stanzaId ? { stanzaId: row.stanzaId } : {}),
      ...(row.originId ? { originId: row.originId } : {}),
      direction: row.direction,
      senderJid: row.senderJid,
      ...(row.sourceStickerId ? { sourceStickerId: row.sourceStickerId } : {}),
      ...(savedStickerId ? { savedStickerId } : {}),
      ...(row.name ? { name: row.name } : {}),
      ...(row.altText ? { altText: row.altText } : {}),
      ...(row.fallbackText ? { fallbackText: row.fallbackText } : {}),
      mimeType: row.mimeType,
      sizeBytes: String(row.sizeBytes),
      width: row.width,
      height: row.height,
      hashAlgorithm: row.hashAlgorithm,
      hashValue: row.hashValue,
      ...(row.remoteUrl ? { remoteUrl: row.remoteUrl } : {}),
      ...(row.storageProviderId ? { storageProviderId: row.storageProviderId } : {}),
      ...(row.storageOrigin ? { storageOrigin: row.storageOrigin } : {}),
      ...(row.localAssetId ? { localAssetId: row.localAssetId } : {}),
      ...(row.storageKey ? { storageKey: row.storageKey } : {}),
      transportStatus: row.transportStatus,
      availability: row.availability,
      ...(row.errorCode ? { errorCode: row.errorCode } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getStickerMessageRef(accountId, refId) {
    return this.stickerMessageFromRow(
      this.database
        .prepare(
          `SELECT ref_id AS refId, preview_sticker_id AS previewStickerId, account_id AS accountId,
        conversation_id AS conversationId, client_message_id AS clientMessageId, stanza_id AS stanzaId,
        origin_id AS originId, direction, sender_jid AS senderJid, source_sticker_id AS sourceStickerId,
        name, alt_text AS altText, fallback_text AS fallbackText, mime_type AS mimeType, size_bytes AS sizeBytes, width, height,
        hash_algorithm AS hashAlgorithm, hash_value AS hashValue, remote_url AS remoteUrl,
        storage_provider_id AS storageProviderId, storage_origin AS storageOrigin,
        local_asset_id AS localAssetId, storage_key AS storageKey, transport_status AS transportStatus,
        availability, error_code AS errorCode, created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_message_refs WHERE account_id = ? AND ref_id = ?`,
        )
        .get(accountId, refId),
    );
  }

  getStickerMessageRefByClientMessageId(
    accountId,
    clientMessageId,
    conversationId,
    direction = 'outgoing',
    senderJid = accountId,
  ) {
    return this.stickerMessageFromRow(
      this.database
        .prepare(
          `SELECT ref_id AS refId, preview_sticker_id AS previewStickerId, account_id AS accountId,
        conversation_id AS conversationId, client_message_id AS clientMessageId, stanza_id AS stanzaId,
        origin_id AS originId, direction, sender_jid AS senderJid, source_sticker_id AS sourceStickerId,
        name, alt_text AS altText, fallback_text AS fallbackText, mime_type AS mimeType, size_bytes AS sizeBytes, width, height,
        hash_algorithm AS hashAlgorithm, hash_value AS hashValue, remote_url AS remoteUrl,
        storage_provider_id AS storageProviderId, storage_origin AS storageOrigin,
        local_asset_id AS localAssetId, storage_key AS storageKey, transport_status AS transportStatus,
        availability, error_code AS errorCode, created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_message_refs WHERE account_id = ? AND client_message_id = ? AND direction = ?
         AND conversation_id = ? AND sender_jid = ?`,
        )
        .get(accountId, clientMessageId, direction, conversationId, senderJid),
    );
  }

  upsertStickerMessageRef(record) {
    if (
      !record?.refId ||
      !record.accountId ||
      !record.conversationId ||
      !record.clientMessageId ||
      !record.previewStickerId
    )
      throw persistenceError('INVALID_INPUT', 'referencia de sticker incompleta');
    const existingIdentity = this.getStickerMessageRef(record.accountId, record.refId);
    const senderJid = record.senderJid || record.accountId;
    if (
      existingIdentity &&
      (existingIdentity.conversationId !== record.conversationId ||
        existingIdentity.clientMessageId !== record.clientMessageId ||
        existingIdentity.direction !== record.direction ||
        existingIdentity.senderJid !== senderJid)
    )
      throw persistenceError('CONFLICT', 'la referencia de sticker pertenece a otra identidad');
    const existingByIdentity = this.getStickerMessageRefByClientMessageId(
      record.accountId,
      record.clientMessageId,
      record.conversationId,
      record.direction,
      senderJid,
    );
    if (
      existingByIdentity &&
      (existingByIdentity.sourceStickerId !== record.sourceStickerId ||
        String(existingByIdentity.hashValue).toLowerCase() !==
          String(record.hashValue).toLowerCase() ||
        existingByIdentity.mimeType !== record.mimeType ||
        String(existingByIdentity.sizeBytes) !== String(record.sizeBytes) ||
        existingByIdentity.width !== record.width ||
        existingByIdentity.height !== record.height ||
        (existingByIdentity.storageProviderId &&
          record.storageProviderId &&
          existingByIdentity.storageProviderId !== record.storageProviderId) ||
        (existingByIdentity.storageOrigin &&
          record.storageOrigin &&
          existingByIdentity.storageOrigin !== record.storageOrigin))
    )
      throw persistenceError('CONFLICT', 'la identidad de sticker ya tiene otro contenido');
    const targetRefId = existingByIdentity?.refId || record.refId;
    const previewStickerId = previewStickerIdForMessage(targetRefId);
    this.database
      .prepare(
        `INSERT INTO sticker_message_refs(
        ref_id, account_id, conversation_id, client_message_id, stanza_id, origin_id, direction,
        sender_jid, source_sticker_id, preview_sticker_id, name, alt_text, fallback_text, mime_type, size_bytes,
        width, height, hash_algorithm, hash_value, remote_url, storage_provider_id, storage_origin, local_asset_id, storage_key,
        transport_status, availability, error_code, created_at, updated_at
      ) VALUES (
        @refId, @accountId, @conversationId, @clientMessageId, @stanzaId, @originId, @direction,
        @senderJid, @sourceStickerId, @previewStickerId, @name, @altText, @fallbackText, @mimeType, @sizeBytes,
        @width, @height, @hashAlgorithm, @hashValue, @remoteUrl, @storageProviderId, @storageOrigin, @localAssetId, @storageKey,
        @transportStatus, @availability, @errorCode, @createdAt, @updatedAt
      ) ON CONFLICT(ref_id) DO UPDATE SET
        stanza_id = excluded.stanza_id,
        origin_id = excluded.origin_id,
        direction = excluded.direction,
        sender_jid = excluded.sender_jid,
        source_sticker_id = excluded.source_sticker_id,
        preview_sticker_id = excluded.preview_sticker_id,
        name = excluded.name,
        alt_text = excluded.alt_text,
        fallback_text = COALESCE(excluded.fallback_text, sticker_message_refs.fallback_text),
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        width = excluded.width,
        height = excluded.height,
        hash_algorithm = excluded.hash_algorithm,
        hash_value = sticker_message_refs.hash_value,
        remote_url = COALESCE(excluded.remote_url, sticker_message_refs.remote_url),
        storage_provider_id = COALESCE(excluded.storage_provider_id, sticker_message_refs.storage_provider_id),
        storage_origin = COALESCE(excluded.storage_origin, sticker_message_refs.storage_origin),
        local_asset_id = CASE WHEN sticker_message_refs.availability = 'available'
          THEN COALESCE(sticker_message_refs.local_asset_id, excluded.local_asset_id)
          ELSE COALESCE(excluded.local_asset_id, sticker_message_refs.local_asset_id) END,
        storage_key = CASE WHEN sticker_message_refs.availability = 'available'
          THEN COALESCE(sticker_message_refs.storage_key, excluded.storage_key)
          ELSE COALESCE(excluded.storage_key, sticker_message_refs.storage_key) END,
        transport_status = CASE
          WHEN sticker_message_refs.transport_status IN ('sent', 'failed') THEN sticker_message_refs.transport_status
          WHEN sticker_message_refs.transport_status = 'sending' AND excluded.transport_status IN ('queued', 'uploading') THEN 'sending'
          WHEN sticker_message_refs.transport_status = 'uploading' AND excluded.transport_status = 'queued' THEN 'uploading'
          ELSE excluded.transport_status END,
        availability = CASE WHEN sticker_message_refs.availability = 'available' AND excluded.availability = 'missing' THEN 'available' ELSE excluded.availability END,
        error_code = CASE
          WHEN sticker_message_refs.transport_status = 'sent' THEN sticker_message_refs.error_code
          WHEN sticker_message_refs.transport_status = 'failed' THEN COALESCE(sticker_message_refs.error_code, excluded.error_code)
          ELSE excluded.error_code END,
        updated_at = CASE
          WHEN sticker_message_refs.transport_status IN ('sent', 'failed') THEN sticker_message_refs.updated_at
          WHEN sticker_message_refs.transport_status = 'sending' AND excluded.transport_status IN ('queued', 'uploading') THEN sticker_message_refs.updated_at
          WHEN sticker_message_refs.transport_status = 'uploading' AND excluded.transport_status = 'queued' THEN sticker_message_refs.updated_at
          ELSE excluded.updated_at END`,
      )
      .run({
        refId: targetRefId,
        accountId: record.accountId,
        conversationId: record.conversationId,
        clientMessageId: record.clientMessageId,
        stanzaId: record.stanzaId || null,
        originId: record.originId || null,
        direction: record.direction,
        senderJid,
        sourceStickerId: record.sourceStickerId || null,
        previewStickerId,
        name: record.name || null,
        altText: record.altText || null,
        fallbackText: record.fallbackText || null,
        mimeType: record.mimeType,
        sizeBytes: String(record.sizeBytes),
        width: record.width,
        height: record.height,
        hashAlgorithm: 'sha-256',
        hashValue: record.hashValue,
        remoteUrl: record.remoteUrl || null,
        storageProviderId: record.storageProviderId || null,
        storageOrigin: record.storageOrigin || null,
        localAssetId: record.localAssetId || null,
        storageKey: record.storageKey || null,
        transportStatus: record.transportStatus,
        availability: record.availability,
        errorCode: record.errorCode || null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    return (
      this.getStickerMessageRef(record.accountId, targetRefId) ||
      this.getStickerMessageRefByClientMessageId(
        record.accountId,
        record.clientMessageId,
        record.conversationId,
        record.direction,
        senderJid,
      )
    );
  }

  markStickerMessageAvailable(accountId, refId, changes) {
    this.database
      .prepare(
        `UPDATE sticker_message_refs SET local_asset_id = ?, storage_key = ?, availability = ?, error_code = NULL, updated_at = ?
       WHERE account_id = ? AND ref_id = ?`,
      )
      .run(
        changes.localAssetId,
        changes.storageKey,
        changes.availability,
        changes.updatedAt,
        accountId,
        refId,
      );
    return this.getStickerMessageRef(accountId, refId);
  }

  markStickerMessageFailed(accountId, refId, errorCode, updatedAt) {
    this.database
      .prepare(
        `UPDATE sticker_message_refs SET transport_status = 'failed', error_code = ?, updated_at = ?
       WHERE account_id = ? AND ref_id = ? AND transport_status IN ('queued', 'uploading', 'sending')`,
      )
      .run(errorCode || 'STORAGE_FAILED', updatedAt, accountId, refId);
    return this.getStickerMessageRef(accountId, refId);
  }

  markStickerMessageUnavailable(accountId, refId, errorCode, updatedAt) {
    this.database
      .prepare(
        `UPDATE sticker_message_refs SET availability = 'missing', error_code = ?, updated_at = ?
       WHERE account_id = ? AND ref_id = ?`,
      )
      .run(errorCode || 'MEDIA_PREVIEW_UNAVAILABLE', updatedAt, accountId, refId);
    return this.getStickerMessageRef(accountId, refId);
  }

  listStickerMessageRefs(accountId, conversationId, limit = 100) {
    const rows = this.database
      .prepare(
        `SELECT ref_id AS refId, preview_sticker_id AS previewStickerId, account_id AS accountId,
        conversation_id AS conversationId, client_message_id AS clientMessageId, stanza_id AS stanzaId,
        origin_id AS originId, direction, sender_jid AS senderJid, source_sticker_id AS sourceStickerId,
        name, alt_text AS altText, fallback_text AS fallbackText, mime_type AS mimeType, size_bytes AS sizeBytes, width, height,
        hash_algorithm AS hashAlgorithm, hash_value AS hashValue, remote_url AS remoteUrl,
        local_asset_id AS localAssetId, storage_key AS storageKey, transport_status AS transportStatus,
        availability, error_code AS errorCode, created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_message_refs WHERE account_id = ? AND conversation_id = ?
       ORDER BY created_at ASC, ref_id ASC LIMIT ?`,
      )
      .all(accountId, conversationId, limit);
    return rows.map((row) => this.stickerMessageFromRow(row));
  }
}

module.exports = { StickerMessagePersistence };
