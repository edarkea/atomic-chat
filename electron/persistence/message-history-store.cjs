class MessageHistoryStore {
  constructor(database) {
    this.database = database;
  }

  saveMessage(message) {
    if (!message.accountId) throw new Error('INVALID_INPUT');
    const classification = message.classification || 'direct';
    if (!['direct', 'broadcast'].includes(classification)) throw new Error('INVALID_INPUT');
    this.database
      .prepare(
        `INSERT INTO messages(id, account_id, conversation_id, client_message_id, sender_jid, body, status, created_at, classification, message_id, origin_id, stanza_ids_json, reply_to_json)
      VALUES (@id, @accountId, @conversationId, @clientMessageId, @senderJid, @body, @status, @createdAt, @classification, @messageId, @originId, @stanzaIdsJson, @replyToJson)
      ON CONFLICT(account_id, client_message_id) DO UPDATE SET status=@status, body=@body, classification=@classification,
        message_id=COALESCE(excluded.message_id, messages.message_id), origin_id=COALESCE(excluded.origin_id, messages.origin_id),
        stanza_ids_json=COALESCE(excluded.stanza_ids_json, messages.stanza_ids_json), reply_to_json=COALESCE(excluded.reply_to_json, messages.reply_to_json)`,
      )
      .run({
        ...message,
        classification,
        body: JSON.stringify(message.body),
        messageId: message.messageId || null,
        originId: message.originId || null,
        stanzaIdsJson: message.stanzaIds ? JSON.stringify(message.stanzaIds) : null,
        replyToJson: message.replyTo ? JSON.stringify(message.replyTo) : null,
      });
  }

  messageFromRow(row) {
    return {
      ...row,
      accountId: row.accountId,
      body: JSON.parse(row.body),
      ...(row.messageId ? { messageId: row.messageId } : {}),
      ...(row.originId ? { originId: row.originId } : {}),
      ...(row.stanzaIdsJson ? { stanzaIds: JSON.parse(row.stanzaIdsJson) } : {}),
      ...(row.replyToJson ? { replyTo: JSON.parse(row.replyToJson) } : {}),
    };
  }

  getMessage(accountId, conversationId, messageId) {
    const row = this.database
      .prepare(
        `SELECT id, account_id AS accountId, conversation_id AS conversationId, client_message_id AS clientMessageId,
        sender_jid AS senderJid, body, status, created_at AS createdAt, classification,
        message_id AS messageId, origin_id AS originId, stanza_ids_json AS stanzaIdsJson, reply_to_json AS replyToJson
       FROM messages WHERE account_id = ? AND conversation_id = ? AND
       (id = ? OR client_message_id = ? OR message_id = ? OR origin_id = ? OR
        EXISTS (SELECT 1 FROM json_each(COALESCE(stanza_ids_json, '[]')) WHERE json_extract(json_each.value, '$.id') = ?))`,
      )
      .get(accountId, conversationId, messageId, messageId, messageId, messageId, messageId);
    if (!row) return null;
    return this.messageFromRow(row);
  }

  saveReaction(reaction) {
    const targetKey =
      reaction.target.originId || reaction.target.stanzaIds?.[0]?.id || reaction.target.messageId;
    if (!reaction?.accountId || !reaction.conversationId || !targetKey || !reaction.reactions)
      throw new Error('INVALID_INPUT');
    const transaction = this.database.transaction(() => {
      if (reaction.actorId) {
        const emojis = [...new Set(reaction.actorEmojis || [])];
        if (!emojis.length) {
          this.database
            .prepare(
              'DELETE FROM message_reactions WHERE account_id = ? AND conversation_id = ? AND source = ? AND target_key = ? AND actor_key = ?',
            )
            .run(
              reaction.accountId,
              reaction.conversationId,
              reaction.source,
              targetKey,
              reaction.actorId,
            );
          return;
        }
        this.database
          .prepare(
            `
          INSERT INTO message_reactions(account_id, conversation_id, source, target_key, actor_key, target_json, emojis_json, session_generation, updated_at)
          VALUES (@accountId, @conversationId, @source, @targetKey, @actorKey, @targetJson, @emojisJson, @sessionGeneration, @updatedAt)
          ON CONFLICT(account_id, conversation_id, source, target_key, actor_key) DO UPDATE SET
            target_json=excluded.target_json, emojis_json=excluded.emojis_json,
            session_generation=excluded.session_generation, updated_at=excluded.updated_at
        `,
          )
          .run({
            accountId: reaction.accountId,
            conversationId: reaction.conversationId,
            source: reaction.source,
            targetKey,
            actorKey: reaction.actorId,
            targetJson: JSON.stringify(reaction.target),
            emojisJson: JSON.stringify(emojis),
            sessionGeneration: reaction.sessionGeneration || null,
            updatedAt: reaction.updatedAt,
          });
        return;
      }
      for (const actor of reaction.reactions.flatMap((item) => item.actors)) {
        const emojis = reaction.reactions
          .filter((item) => item.actors.some((candidate) => candidate.id === actor.id))
          .map((item) => item.emoji);
        this.database
          .prepare(
            `
          INSERT INTO message_reactions(account_id, conversation_id, source, target_key, actor_key, target_json, emojis_json, session_generation, updated_at)
          VALUES (@accountId, @conversationId, @source, @targetKey, @actorKey, @targetJson, @emojisJson, @sessionGeneration, @updatedAt)
          ON CONFLICT(account_id, conversation_id, source, target_key, actor_key) DO UPDATE SET
            target_json=excluded.target_json, emojis_json=excluded.emojis_json,
            session_generation=excluded.session_generation, updated_at=excluded.updated_at
        `,
          )
          .run({
            accountId: reaction.accountId,
            conversationId: reaction.conversationId,
            source: reaction.source,
            targetKey,
            actorKey: actor.id,
            targetJson: JSON.stringify(reaction.target),
            emojisJson: JSON.stringify(emojis),
            sessionGeneration: reaction.sessionGeneration || null,
            updatedAt: reaction.updatedAt,
          });
      }
      const activeActors = new Set(
        reaction.reactions.flatMap((item) => item.actors.map((actor) => actor.id)),
      );
      const existing = this.database
        .prepare(
          'SELECT actor_key AS actorKey FROM message_reactions WHERE account_id = ? AND conversation_id = ? AND source = ? AND target_key = ?',
        )
        .all(reaction.accountId, reaction.conversationId, reaction.source, targetKey);
      for (const actor of existing)
        if (!activeActors.has(actor.actorKey))
          this.database
            .prepare(
              'DELETE FROM message_reactions WHERE account_id = ? AND conversation_id = ? AND source = ? AND target_key = ? AND actor_key = ?',
            )
            .run(
              reaction.accountId,
              reaction.conversationId,
              reaction.source,
              targetKey,
              actor.actorKey,
            );
    });
    transaction();
  }

  reactionRows(accountId, conversationId, source, targetKey) {
    return this.database
      .prepare(
        'SELECT actor_key AS actorKey, emojis_json AS emojisJson FROM message_reactions WHERE account_id = ? AND conversation_id = ? AND source = ? AND target_key = ?',
      )
      .all(accountId, conversationId, source, targetKey);
  }

  attachDirectReactions(messages, accountId, conversationId) {
    return messages.map((message) => {
      const targetKeys = [
        ...new Set(
          [
            message.originId,
            message.messageId,
            ...(message.stanzaIds || []).map((item) => item.id),
          ].filter(Boolean),
        ),
      ];
      if (!targetKeys.length) return message;
      const rows = [
        ...new Map(
          targetKeys
            .flatMap((targetKey) =>
              this.reactionRows(accountId, conversationId, 'direct', targetKey),
            )
            .map((row) => [row.actorKey, row]),
        ).values(),
      ];
      const reactions = [...new Set(rows.flatMap((row) => JSON.parse(row.emojisJson)))].map(
        (emoji) => ({
          emoji,
          actors: rows
            .filter((row) => JSON.parse(row.emojisJson).includes(emoji))
            .map((row) => ({
              id: row.actorKey,
              label: row.actorKey,
              realJid: row.actorKey,
              identifiable: true,
            })),
        }),
      );
      return reactions.length ? { ...message, reactions } : message;
    });
  }

  listMessages(accountId, conversationId) {
    const result = this.database
      .prepare(
        `SELECT id, account_id AS accountId, conversation_id AS conversationId, client_message_id AS clientMessageId,
      sender_jid AS senderJid, body, status, created_at AS createdAt, classification,
      message_id AS messageId, origin_id AS originId, stanza_ids_json AS stanzaIdsJson, reply_to_json AS replyToJson
      FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY created_at ASC`,
      )
      .all(accountId, conversationId)
      .map((row) => this.messageFromRow(row));
    return this.attachDirectReactions(result, accountId, conversationId);
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
        `SELECT id, account_id AS accountId, conversation_id AS conversationId, client_message_id AS clientMessageId,
      sender_jid AS senderJid, body, status, created_at AS createdAt, classification,
      message_id AS messageId, origin_id AS originId, stanza_ids_json AS stanzaIdsJson, reply_to_json AS replyToJson FROM messages
      WHERE account_id = ? AND conversation_id = ?${predicate} ${order} LIMIT ?`,
      )
      .all(...values, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((row) => this.messageFromRow(row));
    if (direction === 'older') page.reverse();
    return { items: this.attachDirectReactions(page, accountId, conversationId), hasMore };
  }

  searchMessages(accountId, query, conversationId, limit, cursor) {
    const values = [accountId];
    const scope = conversationId ? `conversation:${conversationId}` : 'all';
    const pattern = `%${query.replaceAll('~', '~~').replaceAll('%', '~%').replaceAll('_', '~_')}%`;
    let predicate = `WHERE account_id = ? AND json_extract(body, '$.text') LIKE ? ESCAPE '~'`;
    values.push(pattern);
    if (conversationId) {
      predicate += ' AND conversation_id = ?';
      values.push(conversationId);
    }
    if (cursor) {
      predicate += ' AND (created_at < ? OR (created_at = ? AND id < ?))';
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = this.database
      .prepare(
        `SELECT id, account_id AS accountId, conversation_id AS conversationId, sender_jid AS senderJid,
        json_extract(body, '$.text') AS bodyText, created_at AS createdAt
       FROM messages ${predicate} ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(...values, limit + 1);
    const hasMore = rows.length > limit;
    return {
      scope,
      items: rows.slice(0, limit).map((row) => ({
        messageId: row.id,
        accountId: row.accountId,
        conversationId: row.conversationId,
        senderJid: row.senderJid,
        bodyPreview: String(row.bodyText || '').slice(0, 240),
        createdAt: row.createdAt,
      })),
      hasMore,
    };
  }

  listMessagesAround(accountId, conversationId, messageId, createdAt, limit) {
    const rows = this.database
      .prepare(
        `SELECT id, account_id AS accountId, conversation_id AS conversationId, client_message_id AS clientMessageId,
        sender_jid AS senderJid, body, status, created_at AS createdAt, classification,
        message_id AS messageId, origin_id AS originId, stanza_ids_json AS stanzaIdsJson, reply_to_json AS replyToJson
       FROM messages
       WHERE account_id = ? AND conversation_id = ?
         AND (created_at < ? OR (created_at = ? AND id <= ?))
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(accountId, conversationId, createdAt, createdAt, messageId, limit);
    return {
      items: this.attachDirectReactions(
        rows.reverse().map((row) => this.messageFromRow(row)),
        accountId,
        conversationId,
      ),
      hasMore: false,
      nextCursor: null,
    };
  }
}

module.exports = { MessageHistoryStore };
