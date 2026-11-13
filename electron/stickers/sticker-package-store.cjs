function persistenceError(code, message = code) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

class StickerPackageStore {
  constructor(database, insertStickerPackItemsHook) {
    this.database = database;
    this.insertStickerPackItemsHook =
      insertStickerPackItemsHook ||
      ((table, accountId, parentId, stickerIds) =>
        this.insertStickerPackItems(table, accountId, parentId, stickerIds));
  }

  stickerPackFromRow(row) {
    const items = this.database
      .prepare(
        'SELECT sticker_id AS stickerId FROM sticker_pack_items WHERE account_id = ? AND pack_id = ? ORDER BY position ASC',
      )
      .all(row.accountId, row.packId)
      .map((item) => item.stickerId);
    return {
      packId: row.packId,
      accountId: row.accountId,
      source: row.source,
      status: row.status,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      stickerIds: items,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getStickerPack(accountId, packId) {
    const row = this.database
      .prepare(
        `SELECT pack_id AS packId, account_id AS accountId, source, status, name,
        description, revision, created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_packs WHERE account_id = ? AND pack_id = ?`,
      )
      .get(accountId, packId);
    return row ? this.stickerPackFromRow(row) : null;
  }

  listStickerPacks(accountId) {
    return this.database
      .prepare(
        `SELECT pack_id AS packId, account_id AS accountId, source, status, name,
        description, revision, created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_packs WHERE account_id = ? ORDER BY updated_at DESC, pack_id ASC`,
      )
      .all(accountId)
      .map((row) => this.stickerPackFromRow(row));
  }

  stickerDraftFromRow(row) {
    const items = this.database
      .prepare(
        'SELECT sticker_id AS stickerId FROM sticker_draft_items WHERE account_id = ? AND draft_id = ? ORDER BY position ASC',
      )
      .all(row.accountId, row.draftId)
      .map((item) => item.stickerId);
    return {
      draftId: row.draftId,
      accountId: row.accountId,
      ...(row.basePackId
        ? { basePackId: row.basePackId, basePackRevision: row.basePackRevision }
        : {}),
      status: row.status,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      stickerIds: items,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  getStickerDraft(accountId, draftId) {
    const row = this.database
      .prepare(
        `SELECT draft_id AS draftId, account_id AS accountId, base_pack_id AS basePackId,
        base_pack_revision AS basePackRevision, status, name, description, revision,
        created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_drafts WHERE account_id = ? AND draft_id = ?`,
      )
      .get(accountId, draftId);
    return row ? this.stickerDraftFromRow(row) : null;
  }

  listStickerDrafts(accountId) {
    return this.database
      .prepare(
        `SELECT draft_id AS draftId, account_id AS accountId, base_pack_id AS basePackId,
        base_pack_revision AS basePackRevision, status, name, description, revision,
        created_at AS createdAt, updated_at AS updatedAt
       FROM sticker_drafts WHERE account_id = ? AND status NOT IN ('discarded', 'saved')
       ORDER BY updated_at DESC, draft_id ASC`,
      )
      .all(accountId)
      .map((row) => this.stickerDraftFromRow(row));
  }

  insertStickerPackItems(table, accountId, parentId, stickerIds) {
    const statement =
      table === 'sticker_pack_items'
        ? this.database.prepare(
            'INSERT INTO sticker_pack_items(account_id, pack_id, sticker_id, position) VALUES (?, ?, ?, ?)',
          )
        : this.database.prepare(
            'INSERT INTO sticker_draft_items(account_id, draft_id, sticker_id, position) VALUES (?, ?, ?, ?)',
          );
    stickerIds.forEach((stickerId, position) =>
      statement.run(accountId, parentId, stickerId, position),
    );
  }

  insertPackageItems(table, accountId, parentId, stickerIds) {
    return this.insertStickerPackItemsHook(table, accountId, parentId, stickerIds);
  }

  saveStickerPack(record) {
    const transaction = this.database.transaction(() => {
      const now = record.updatedAt;
      if (record.revision > 0) {
        const changed = this.database
          .prepare(
            `UPDATE sticker_packs SET name = @name, description = @description, revision = @nextRevision, updated_at = @updatedAt
           WHERE account_id = @accountId AND pack_id = @packId AND revision = @revision`,
          )
          .run({ ...record, nextRevision: record.revision + 1 });
        if (changed.changes !== 1)
          throw persistenceError('CONFLICT', 'la revisión del paquete está obsoleta');
        this.database
          .prepare('DELETE FROM sticker_pack_items WHERE account_id = ? AND pack_id = ?')
          .run(record.accountId, record.packId);
      } else {
        this.database
          .prepare(
            `INSERT INTO sticker_packs(pack_id, account_id, source, status, name, description, revision, created_at, updated_at)
           VALUES (@packId, @accountId, 'created', 'installed', @name, @description, 1, @createdAt, @updatedAt)`,
          )
          .run(record);
      }
      this.insertPackageItems(
        'sticker_pack_items',
        record.accountId,
        record.packId,
        record.stickerIds,
      );
    });
    transaction();
    return this.getStickerPack(record.accountId, record.packId);
  }

  deleteStickerPack(accountId, packId, revision) {
    const transaction = this.database.transaction(() => {
      const current = this.database
        .prepare('SELECT revision FROM sticker_packs WHERE account_id = ? AND pack_id = ?')
        .get(accountId, packId);
      if (!current) throw persistenceError('MEDIA_PREVIEW_UNAVAILABLE', 'el paquete no existe');
      if (current.revision !== revision)
        throw persistenceError('CONFLICT', 'la revisión del paquete está obsoleta');
      const activeDraft = this.database
        .prepare(
          `SELECT 1 FROM sticker_drafts WHERE account_id = ? AND base_pack_id = ? AND status NOT IN ('discarded', 'saved') LIMIT 1`,
        )
        .get(accountId, packId);
      if (activeDraft) throw persistenceError('CONFLICT', 'el paquete tiene un borrador activo');
      this.database
        .prepare(
          "UPDATE sticker_drafts SET base_pack_id = NULL, base_pack_revision = NULL WHERE account_id = ? AND base_pack_id = ? AND status = 'saved'",
        )
        .run(accountId, packId);
      this.database
        .prepare('DELETE FROM sticker_packs WHERE account_id = ? AND pack_id = ? AND revision = ?')
        .run(accountId, packId, revision);
    });
    transaction();
  }

  createStickerDraft(record) {
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO sticker_drafts(draft_id, account_id, base_pack_id, base_pack_revision, status, name, description, revision, created_at, updated_at)
         VALUES (@draftId, @accountId, @basePackId, @basePackRevision, 'editing', @name, @description, 1, @createdAt, @updatedAt)`,
        )
        .run(record);
      this.insertPackageItems(
        'sticker_draft_items',
        record.accountId,
        record.draftId,
        record.stickerIds,
      );
    });
    transaction();
    return this.getStickerDraft(record.accountId, record.draftId);
  }

  updateStickerDraft(record) {
    const transaction = this.database.transaction(() => {
      const changed = this.database
        .prepare(
          `UPDATE sticker_drafts SET name = @name, description = @description, status = 'editing', revision = @nextRevision, updated_at = @updatedAt
         WHERE account_id = @accountId AND draft_id = @draftId AND revision = @revision AND status NOT IN ('discarded', 'saved')`,
        )
        .run({ ...record, nextRevision: record.revision + 1 });
      if (changed.changes !== 1)
        throw persistenceError('CONFLICT', 'la revisión del borrador está obsoleta');
      this.database
        .prepare('DELETE FROM sticker_draft_items WHERE account_id = ? AND draft_id = ?')
        .run(record.accountId, record.draftId);
      this.insertPackageItems(
        'sticker_draft_items',
        record.accountId,
        record.draftId,
        record.stickerIds,
      );
    });
    transaction();
    return this.getStickerDraft(record.accountId, record.draftId);
  }

  discardStickerDraft(accountId, draftId, revision) {
    const changed = this.database
      .prepare(
        `UPDATE sticker_drafts SET status = 'discarded', revision = revision + 1, updated_at = ?
       WHERE account_id = ? AND draft_id = ? AND revision = ? AND status NOT IN ('discarded', 'saved')`,
      )
      .run(new Date().toISOString(), accountId, draftId, revision);
    if (changed.changes !== 1) {
      const current = this.getStickerDraft(accountId, draftId);
      if (current?.status === 'discarded') return;
      throw persistenceError('CONFLICT', 'la revisión del borrador está obsoleta');
    }
  }

  commitStickerDraft(accountId, draftId, revision, packId, packRevision, now) {
    let committedPackId = packId;
    const transaction = this.database.transaction(() => {
      const draft = this.database
        .prepare(
          `SELECT draft_id AS draftId, account_id AS accountId, base_pack_id AS basePackId,
          base_pack_revision AS basePackRevision, status, name, description, revision,
          created_at AS createdAt, updated_at AS updatedAt
         FROM sticker_drafts WHERE account_id = ? AND draft_id = ?`,
        )
        .get(accountId, draftId);
      if (!draft || draft.revision !== revision || ['discarded', 'saved'].includes(draft.status))
        throw persistenceError('CONFLICT', 'el borrador no está disponible');
      const stickerIds = this.database
        .prepare(
          'SELECT sticker_id AS stickerId FROM sticker_draft_items WHERE account_id = ? AND draft_id = ? ORDER BY position ASC',
        )
        .all(accountId, draftId)
        .map((item) => item.stickerId);
      if (draft.basePackId) {
        committedPackId = draft.basePackId;
        const changed = this.database
          .prepare(
            `UPDATE sticker_packs SET name = ?, description = ?, revision = revision + 1, updated_at = ?
           WHERE account_id = ? AND pack_id = ? AND revision = ?`,
          )
          .run(
            draft.name,
            draft.description || null,
            now,
            accountId,
            draft.basePackId,
            draft.basePackRevision,
          );
        if (changed.changes !== 1)
          throw persistenceError('CONFLICT', 'el paquete cambió durante la edición');
        this.database
          .prepare('DELETE FROM sticker_pack_items WHERE account_id = ? AND pack_id = ?')
          .run(accountId, draft.basePackId);
        this.insertPackageItems('sticker_pack_items', accountId, draft.basePackId, stickerIds);
      } else {
        this.database
          .prepare(
            `INSERT INTO sticker_packs(pack_id, account_id, source, status, name, description, revision, created_at, updated_at)
           VALUES (?, ?, 'created', 'installed', ?, ?, 1, ?, ?)`,
          )
          .run(packId, accountId, draft.name, draft.description || null, now, now);
        this.insertPackageItems('sticker_pack_items', accountId, packId, stickerIds);
      }
      this.database
        .prepare(
          `UPDATE sticker_drafts SET status = 'saved', revision = revision + 1, updated_at = ?
         WHERE account_id = ? AND draft_id = ?`,
        )
        .run(now, accountId, draftId);
    });
    transaction();
    return this.getStickerPack(accountId, committedPackId);
  }
}

module.exports = { StickerPackageStore };
