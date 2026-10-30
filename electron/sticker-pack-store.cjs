const crypto = require('node:crypto');

const MAX_PACK_NAME_LENGTH = 128;
const MAX_PACK_DESCRIPTION_LENGTH = 1024;
const MAX_PACK_STICKERS = 250;

function packError(code, message = code) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

function normalizeDescription(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > MAX_PACK_DESCRIPTION_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw packError('INVALID_INPUT', 'la descripción del paquete no es válida');
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeName(value, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > MAX_PACK_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(value))
    throw packError('INVALID_INPUT', 'el nombre del paquete no es válido');
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!allowEmpty && !normalized) throw packError('INVALID_INPUT', 'el nombre del paquete es obligatorio');
  return normalized;
}

function normalizeStickerIds(stickerIds, allowEmpty) {
  if (!Array.isArray(stickerIds) || (!allowEmpty && stickerIds.length === 0) || stickerIds.length > MAX_PACK_STICKERS)
    throw packError('INVALID_INPUT', 'la lista de stickers no es válida');
  const normalized = stickerIds.map((stickerId) => {
    if (typeof stickerId !== 'string' || !stickerId.trim() || stickerId.length > 512)
      throw packError('INVALID_INPUT', 'el identificador de sticker no es válido');
    return stickerId.trim();
  });
  if (new Set(normalized).size !== normalized.length) throw packError('CONFLICT', 'el paquete contiene stickers repetidos');
  return normalized;
}

class StickerPackStore {
  constructor(persistence) {
    this.persistence = persistence;
    this.locks = new Map();
  }

  withAccountLock(accountId, operation) {
    const previous = this.locks.get(accountId) || Promise.resolve();
    const tracked = previous.catch(() => undefined).then(operation).finally(() => {
      if (this.locks.get(accountId) === tracked) this.locks.delete(accountId);
    });
    this.locks.set(accountId, tracked);
    return tracked;
  }

  assertAuthorized(isAuthorized) {
    if (!isAuthorized()) throw packError('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
  }

  assertStickerOwnership(accountId, stickerIds, existingStickerIds = new Set()) {
    for (const stickerId of stickerIds) {
      const sticker = this.persistence.getSticker(accountId, stickerId);
      if (!sticker || sticker.accountId !== accountId) throw packError('UNAUTHORIZED', 'el sticker no pertenece a la cuenta');
      if (existingStickerIds.has(stickerId)) continue;
      const asset = this.persistence.getStickerAsset(accountId, sticker.assetId);
      if (!asset || asset.accountId !== accountId || asset.availability !== 'available' || sticker.availability !== 'available')
        throw packError('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
    }
  }

  list(accountId, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      return { accountId, packs: this.persistence.listStickerPacks(accountId) };
    });
  }

  get(accountId, packId, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      const pack = this.persistence.getStickerPack(accountId, packId);
      if (!pack) throw packError('MEDIA_PREVIEW_UNAVAILABLE', 'el paquete no está disponible');
      return pack;
    });
  }

  save(input, isAuthorized = () => true) {
    const name = normalizeName(input.name);
    const description = normalizeDescription(input.description);
    const stickerIds = normalizeStickerIds(input.stickerIds, false);
    return this.withAccountLock(input.accountId, () => {
      this.assertAuthorized(isAuthorized);
      const existing = input.packId ? this.persistence.getStickerPack(input.accountId, input.packId) : null;
      this.assertStickerOwnership(input.accountId, stickerIds, new Set(existing?.stickerIds || []));
      if (input.packId && (!Number.isInteger(input.revision) || input.revision < 1)) throw packError('INVALID_INPUT', 'la revisión del paquete no es válida');
      if (!input.packId && input.revision !== 0) throw packError('CONFLICT', 'la revisión inicial del paquete no es válida');
      const now = new Date().toISOString();
      const packId = input.packId || `sticker_pack_${crypto.randomUUID()}`;
      const value = this.persistence.saveStickerPack({
        accountId: input.accountId, packId, revision: input.revision, name, description: description || null,
        stickerIds, createdAt: now, updatedAt: now,
      });
      this.assertAuthorized(isAuthorized);
      return value;
    });
  }

  delete(accountId, packId, revision, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      if (!Number.isInteger(revision) || revision < 1) throw packError('INVALID_INPUT', 'la revisión del paquete no es válida');
      this.persistence.deleteStickerPack(accountId, packId, revision);
      this.assertAuthorized(isAuthorized);
    });
  }

  listDrafts(accountId, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      return { accountId, drafts: this.persistence.listStickerDrafts(accountId) };
    });
  }

  getDraft(accountId, draftId, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      const draft = this.persistence.getStickerDraft(accountId, draftId);
      if (!draft) throw packError('MEDIA_PREVIEW_UNAVAILABLE', 'el borrador no está disponible');
      return draft;
    });
  }

  createDraft(accountId, basePackId, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      let basePack;
      if (basePackId) {
        basePack = this.persistence.getStickerPack(accountId, basePackId);
        if (!basePack) throw packError('MEDIA_PREVIEW_UNAVAILABLE', 'el paquete no está disponible');
      }
      const now = new Date().toISOString();
      const draft = this.persistence.createStickerDraft({
        draftId: `sticker_draft_${crypto.randomUUID()}`,
        accountId,
        basePackId: basePack?.packId || null,
        basePackRevision: basePack?.revision || null,
        name: basePack?.name || '',
        description: basePack?.description || null,
        stickerIds: basePack?.stickerIds || [],
        createdAt: now,
        updatedAt: now,
      });
      this.assertAuthorized(isAuthorized);
      return draft;
    });
  }

  updateDraft(input, isAuthorized = () => true) {
    const name = normalizeName(input.name, true);
    const description = normalizeDescription(input.description);
    const stickerIds = normalizeStickerIds(input.stickerIds, true);
    return this.withAccountLock(input.accountId, () => {
      this.assertAuthorized(isAuthorized);
      const existingDraft = this.persistence.getStickerDraft(input.accountId, input.draftId);
      this.assertStickerOwnership(input.accountId, stickerIds, new Set(existingDraft?.stickerIds || []));
      if (!Number.isInteger(input.revision) || input.revision < 1) throw packError('INVALID_INPUT', 'la revisión del borrador no es válida');
      const draft = this.persistence.updateStickerDraft({
        accountId: input.accountId, draftId: input.draftId, revision: input.revision,
        name, description: description || null, stickerIds, updatedAt: new Date().toISOString(),
      });
      this.assertAuthorized(isAuthorized);
      return draft;
    });
  }

  discardDraft(accountId, draftId, revision, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      if (!Number.isInteger(revision) || revision < 1) throw packError('INVALID_INPUT', 'la revisión del borrador no es válida');
      this.persistence.discardStickerDraft(accountId, draftId, revision);
      this.assertAuthorized(isAuthorized);
    });
  }

  commitDraft(accountId, draftId, revision, isAuthorized = () => true) {
    return this.withAccountLock(accountId, () => {
      this.assertAuthorized(isAuthorized);
      if (!Number.isInteger(revision) || revision < 1) throw packError('INVALID_INPUT', 'la revisión del borrador no es válida');
      const draft = this.persistence.getStickerDraft(accountId, draftId);
      if (!draft || draft.revision !== revision || ['discarded', 'saved'].includes(draft.status)) throw packError('CONFLICT', 'el borrador no está disponible');
      const name = normalizeName(draft.name);
      const stickerIds = normalizeStickerIds(draft.stickerIds, false);
      const existingPack = draft.basePackId ? this.persistence.getStickerPack(accountId, draft.basePackId) : null;
      this.assertStickerOwnership(accountId, stickerIds, new Set(existingPack?.stickerIds || []));
      const value = this.persistence.commitStickerDraft(
        accountId, draftId, revision, `sticker_pack_${crypto.randomUUID()}`, draft.basePackRevision, new Date().toISOString(),
      );
      this.assertAuthorized(isAuthorized);
      return value;
    });
  }
}

module.exports = { StickerPackStore, MAX_PACK_NAME_LENGTH, MAX_PACK_DESCRIPTION_LENGTH, MAX_PACK_STICKERS };
