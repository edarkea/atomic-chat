function previewStickerIdForMessage(refId) {
  return `message:${refId}`;
}

class TimelineStore {
  constructor(database, attachDirectReactions, getSavedStickerIdForMessage) {
    this.database = database;
    this.attachDirectReactions = attachDirectReactions;
    this.getSavedStickerIdForMessage = getSavedStickerIdForMessage;
  }

  listTimelinePage(accountId, conversationId, limit, direction, cursor) {
    const values = [
      accountId,
      conversationId,
      accountId,
      conversationId,
      accountId,
      conversationId,
      accountId,
      conversationId,
    ];
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
            NULL AS original_name, NULL AS alt_text, NULL AS fallback_text, NULL AS mime_type, NULL AS size_bytes, NULL AS width,
            NULL AS height, NULL AS availability, NULL AS stanza_id, NULL AS origin_id,
            NULL AS source_sticker_id, NULL AS hash_algorithm, NULL AS hash_value,
            NULL AS remote_url, NULL AS local_asset_id,
            message_id AS message_id_for_text, origin_id AS origin_id_for_text,
            stanza_ids_json AS stanza_ids_json_for_text, reply_to_json AS reply_to_json_for_text
          FROM messages WHERE account_id = ? AND conversation_id = ?
          UNION ALL
          SELECT media_id AS id, created_at AS sort_at, 'image' AS kind, account_id,
            conversation_id, NULL, sender_jid, NULL, NULL, NULL, transfer_id, media_id,
            direction, original_name, NULL, NULL, mime_type, size_bytes, width, height, availability,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
          FROM media_assets WHERE account_id = ? AND conversation_id = ?
          UNION ALL
          SELECT file_id AS id, created_at AS sort_at, 'file' AS kind, account_id,
            conversation_id, NULL, sender_jid, NULL, NULL, NULL, transfer_id, NULL,
            direction, original_name, NULL, NULL, mime_type, size_bytes, NULL, NULL, availability,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
          FROM file_assets WHERE account_id = ? AND conversation_id = ?
          UNION ALL
          SELECT ref_id AS id, created_at AS sort_at, 'sticker' AS kind, account_id,
            conversation_id, client_message_id, sender_jid, NULL, transport_status, error_code,
            ref_id, preview_sticker_id, direction, name, alt_text, fallback_text, mime_type, size_bytes, width, height, availability,
            stanza_id, origin_id, source_sticker_id, hash_algorithm, hash_value, remote_url, local_asset_id,
            NULL, NULL, NULL, NULL
          FROM sticker_message_refs WHERE account_id = ? AND conversation_id = ?
        ) AS timeline WHERE 1 = 1${predicate} ${order} LIMIT ?`,
      )
      .all(...values, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => {
      if (row.kind === 'text') {
        const message = {
          id: row.id,
          accountId: row.account_id,
          conversationId: row.conversation_id,
          clientMessageId: row.client_message_id,
          senderJid: row.sender_jid,
          body: JSON.parse(row.body),
          status: row.status,
          createdAt: row.sort_at,
          classification: row.classification,
          ...(row.message_id_for_text ? { messageId: row.message_id_for_text } : {}),
          ...(row.origin_id_for_text ? { originId: row.origin_id_for_text } : {}),
          ...(row.stanza_ids_json_for_text
            ? { stanzaIds: JSON.parse(row.stanza_ids_json_for_text) }
            : {}),
          ...(row.reply_to_json_for_text
            ? { replyTo: JSON.parse(row.reply_to_json_for_text) }
            : {}),
        };
        const [messageWithReactions] = this.attachDirectReactions(
          [message],
          accountId,
          conversationId,
        );
        return {
          kind: 'text',
          id: row.id,
          sortAt: row.sort_at,
          message: messageWithReactions,
        };
      }
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
      if (row.kind === 'sticker') {
        const savedStickerId = this.getSavedStickerIdForMessage(row.account_id, row.transfer_id);
        return {
          kind: 'sticker',
          id: row.id,
          sortAt: row.sort_at,
          sticker: {
            refId: row.transfer_id,
            previewStickerId: previewStickerIdForMessage(row.transfer_id),
            accountId: row.account_id,
            conversationId: row.conversation_id,
            clientMessageId: row.client_message_id,
            direction: row.direction,
            senderJid: row.sender_jid,
            ...(row.stanza_id ? { stanzaId: row.stanza_id } : {}),
            ...(row.origin_id ? { originId: row.origin_id } : {}),
            ...(row.source_sticker_id ? { sourceStickerId: row.source_sticker_id } : {}),
            ...(savedStickerId ? { savedStickerId } : {}),
            ...(row.original_name ? { name: row.original_name } : {}),
            ...(row.alt_text ? { altText: row.alt_text } : {}),
            ...(row.fallback_text ? { fallbackText: row.fallback_text } : {}),
            mimeType: row.mime_type,
            sizeBytes: String(row.size_bytes),
            width: row.width,
            height: row.height,
            hashAlgorithm: row.hash_algorithm,
            hashValue: row.hash_value,
            ...(row.local_asset_id ? { localAssetId: row.local_asset_id } : {}),
            transportStatus: row.status,
            availability: row.availability,
            ...(row.classification ? { errorCode: row.classification } : {}),
            createdAt: row.sort_at,
            updatedAt: row.sort_at,
          },
        };
      }
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
        UNION ALL
        SELECT account_id, conversation_id, created_at AS last_activity FROM sticker_message_refs
      ) WHERE account_id = ?
      GROUP BY account_id, conversation_id ORDER BY lastActivity DESC`,
      )
      .all(accountId);
  }
}

module.exports = { TimelineStore };
