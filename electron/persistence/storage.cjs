const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { MessageHistoryStore } = require('./message-history-store.cjs');
const { MediaFileStore } = require('./media-file-store.cjs');
const { PreferencesStore } = require('./preferences-store.cjs');
const { StickerMessagePersistence } = require('../stickers/sticker-message-persistence.cjs');
const { StickerCatalogStore } = require('../stickers/sticker-catalog-store.cjs');
const { StickerPackageStore } = require('../stickers/sticker-package-store.cjs');
const { TimelineStore } = require('./timeline-store.cjs');
const { SchemaMigrator } = require('./schema-migrator.cjs');
const { AccountConnectionStore } = require('./account-connection-store.cjs');

function persistenceError(code, message = code) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

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
      this.schemaMigrator = new SchemaMigrator(this.database);
      this.accountConnection = new AccountConnectionStore(this.database);
      this.migrate();
      this.messageHistory = new MessageHistoryStore(this.database);
      this.mediaFiles = new MediaFileStore(this.database);
      this.preferences = new PreferencesStore(this.database);
      this.stickerCatalog = new StickerCatalogStore(this.database);
      this.stickerPackages = new StickerPackageStore(
        this.database,
        (table, accountId, parentId, stickerIds) =>
          this.insertStickerPackItems(table, accountId, parentId, stickerIds),
      );
      this.stickerMessagePersistence = new StickerMessagePersistence(
        this.database,
        (accountId, refId) => this.stickerCatalog.getSavedStickerIdForMessage(accountId, refId),
      );
      this.timeline = new TimelineStore(
        this.database,
        (messages, accountId, conversationId) =>
          this.attachDirectReactions(messages, accountId, conversationId),
        (accountId, refId) => this.getSavedStickerIdForMessage(accountId, refId),
      );
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  migrate() {
    return this.schemaMigrator.migrate();
  }

  upsertAccount(account) {
    return this.accountConnection.upsertAccount(account);
  }

  saveConnectionProfile(profile) {
    return this.accountConnection.saveConnectionProfile(profile);
  }

  getConnectionProfile(accountId) {
    return this.accountConnection.getConnectionProfile(accountId);
  }

  listConnectionProfiles() {
    return this.accountConnection.listConnectionProfiles();
  }

  deleteConnectionProfile(accountId) {
    return this.accountConnection.deleteConnectionProfile(accountId);
  }

  profileFromRow(row) {
    return this.accountConnection.profileFromRow(row);
  }

  legacyProfile(row) {
    return this.accountConnection.legacyProfile(row);
  }

  getTrustedCertificate(accountId, host, port, transport) {
    return this.accountConnection.getTrustedCertificate(accountId, host, port, transport);
  }

  upsertTrustedCertificate(record) {
    return this.accountConnection.upsertTrustedCertificate(record);
  }

  saveMessage(message) {
    return this.messageHistory.saveMessage(message);
  }

  messageFromRow(row) {
    return this.messageHistory.messageFromRow(row);
  }

  getMessage(accountId, conversationId, messageId) {
    return this.messageHistory.getMessage(accountId, conversationId, messageId);
  }

  saveReaction(reaction) {
    return this.messageHistory.saveReaction(reaction);
  }

  reactionRows(accountId, conversationId, source, targetKey) {
    return this.messageHistory.reactionRows(accountId, conversationId, source, targetKey);
  }

  attachDirectReactions(messages, accountId, conversationId) {
    return this.messageHistory.attachDirectReactions(messages, accountId, conversationId);
  }

  listMessages(accountId, conversationId) {
    return this.messageHistory.listMessages(accountId, conversationId);
  }

  listMessagesPage(accountId, conversationId, limit, direction, cursor) {
    return this.messageHistory.listMessagesPage(
      accountId,
      conversationId,
      limit,
      direction,
      cursor,
    );
  }

  searchMessages(accountId, query, conversationId, limit, cursor) {
    return this.messageHistory.searchMessages(accountId, query, conversationId, limit, cursor);
  }

  listMessagesAround(accountId, conversationId, messageId, createdAt, limit) {
    return this.messageHistory.listMessagesAround(
      accountId,
      conversationId,
      messageId,
      createdAt,
      limit,
    );
  }

  upsertMedia(record, storageKey = null) {
    return this.mediaFiles.upsertMedia(record, storageKey);
  }

  getMedia(accountId, mediaId) {
    return this.mediaFiles.getMedia(accountId, mediaId);
  }

  getMediaByTransfer(accountId, transferId) {
    return this.mediaFiles.getMediaByTransfer(accountId, transferId);
  }

  listMedia(accountId, conversationId, limit = 100) {
    return this.mediaFiles.listMedia(accountId, conversationId, limit);
  }

  listAllMedia() {
    return this.mediaFiles.listAllMedia();
  }

  updateMediaAvailability(accountId, mediaId, availability) {
    return this.mediaFiles.updateMediaAvailability(accountId, mediaId, availability);
  }

  upsertFileAsset(record) {
    return this.mediaFiles.upsertFileAsset(record);
  }

  getFileAsset(accountId, fileId) {
    return this.mediaFiles.getFileAsset(accountId, fileId);
  }

  updateFileAssetAvailability(accountId, fileId, availability) {
    return this.mediaFiles.updateFileAssetAvailability(accountId, fileId, availability);
  }

  getStickerAssetByHash(accountId, hashValue) {
    return this.stickerCatalog.getStickerAssetByHash(accountId, hashValue);
  }

  getStickerAsset(accountId, assetId) {
    return this.stickerCatalog.getStickerAsset(accountId, assetId);
  }

  countStickers(accountId) {
    return this.stickerCatalog.countStickers(accountId);
  }

  sumStickerStorage(accountId) {
    return this.stickerCatalog.sumStickerStorage(accountId);
  }

  insertStickerAsset(record) {
    return this.stickerCatalog.insertStickerAsset(record);
  }

  insertSticker(record) {
    return this.stickerCatalog.insertSticker(record);
  }

  insertStickerReference(record) {
    return this.stickerCatalog.insertStickerReference(record);
  }

  clearStickerAssetOrphaned(accountId, assetId) {
    return this.stickerCatalog.clearStickerAssetOrphaned(accountId, assetId);
  }

  hasStickerReferences(assetId) {
    return this.stickerCatalog.hasStickerReferences(assetId);
  }

  createStickerAssetAndSticker(asset, sticker) {
    return this.stickerCatalog.createStickerAssetAndSticker(asset, sticker);
  }

  recoverStickerAssetAndSticker(asset, sticker) {
    return this.stickerCatalog.recoverStickerAssetAndSticker(asset, sticker);
  }

  getSticker(accountId, stickerId) {
    return this.stickerCatalog.getSticker(accountId, stickerId);
  }

  getStickerByHash(accountId, hashValue) {
    return this.stickerCatalog.getStickerByHash(accountId, hashValue);
  }

  getSavedStickerIdForMessage(accountId, refId) {
    return this.stickerCatalog.getSavedStickerIdForMessage(accountId, refId);
  }

  listStickers(accountId, query = '', limit = 250, packId) {
    return this.stickerCatalog.listStickers(accountId, query, limit, packId);
  }

  deleteSticker(accountId, stickerId) {
    return this.stickerCatalog.deleteSticker(accountId, stickerId);
  }

  markStickerAssetAvailability(accountId, assetId, availability) {
    return this.stickerCatalog.markStickerAssetAvailability(accountId, assetId, availability);
  }

  updateStickerAsset(record) {
    return this.stickerCatalog.updateStickerAsset(record);
  }

  listStickerAssets(accountId) {
    return this.stickerCatalog.listStickerAssets(accountId);
  }

  deleteStickerAsset(accountId, assetId) {
    return this.stickerCatalog.deleteStickerAsset(accountId, assetId);
  }

  hasStickerPackReferences(accountId, stickerId) {
    return this.stickerCatalog.hasStickerPackReferences(accountId, stickerId);
  }

  hasStickerDraftReferences(accountId, stickerId) {
    return this.stickerCatalog.hasStickerDraftReferences(accountId, stickerId);
  }

  stickerMessageFromRow(row) {
    return this.stickerMessagePersistence.stickerMessageFromRow(row);
  }

  getStickerMessageRef(accountId, refId) {
    return this.stickerMessagePersistence.getStickerMessageRef(accountId, refId);
  }

  getStickerMessageRefByClientMessageId(
    accountId,
    clientMessageId,
    conversationId,
    direction = 'outgoing',
    senderJid = accountId,
  ) {
    return this.stickerMessagePersistence.getStickerMessageRefByClientMessageId(
      accountId,
      clientMessageId,
      conversationId,
      direction,
      senderJid,
    );
  }

  upsertStickerMessageRef(record) {
    return this.stickerMessagePersistence.upsertStickerMessageRef(record);
  }

  markStickerMessageAvailable(accountId, refId, changes) {
    return this.stickerMessagePersistence.markStickerMessageAvailable(accountId, refId, changes);
  }

  markStickerMessageFailed(accountId, refId, errorCode, updatedAt) {
    return this.stickerMessagePersistence.markStickerMessageFailed(
      accountId,
      refId,
      errorCode,
      updatedAt,
    );
  }

  markStickerMessageUnavailable(accountId, refId, errorCode, updatedAt) {
    return this.stickerMessagePersistence.markStickerMessageUnavailable(
      accountId,
      refId,
      errorCode,
      updatedAt,
    );
  }

  listStickerMessageRefs(accountId, conversationId, limit = 100) {
    return this.stickerMessagePersistence.listStickerMessageRefs(accountId, conversationId, limit);
  }

  stickerPackFromRow(row) {
    return this.stickerPackages.stickerPackFromRow(row);
  }

  getStickerPack(accountId, packId) {
    return this.stickerPackages.getStickerPack(accountId, packId);
  }

  listStickerPacks(accountId) {
    return this.stickerPackages.listStickerPacks(accountId);
  }

  stickerDraftFromRow(row) {
    return this.stickerPackages.stickerDraftFromRow(row);
  }

  getStickerDraft(accountId, draftId) {
    return this.stickerPackages.getStickerDraft(accountId, draftId);
  }

  listStickerDrafts(accountId) {
    return this.stickerPackages.listStickerDrafts(accountId);
  }

  insertStickerPackItems(table, accountId, parentId, stickerIds) {
    return this.stickerPackages.insertStickerPackItems(table, accountId, parentId, stickerIds);
  }

  saveStickerPack(record) {
    return this.stickerPackages.saveStickerPack(record);
  }

  deleteStickerPack(accountId, packId, revision) {
    return this.stickerPackages.deleteStickerPack(accountId, packId, revision);
  }

  createStickerDraft(record) {
    return this.stickerPackages.createStickerDraft(record);
  }

  updateStickerDraft(record) {
    return this.stickerPackages.updateStickerDraft(record);
  }

  discardStickerDraft(accountId, draftId, revision) {
    return this.stickerPackages.discardStickerDraft(accountId, draftId, revision);
  }

  commitStickerDraft(accountId, draftId, revision, packId, packRevision, now) {
    return this.stickerPackages.commitStickerDraft(
      accountId,
      draftId,
      revision,
      packId,
      packRevision,
      now,
    );
  }

  listTimelinePage(accountId, conversationId, limit, direction, cursor) {
    return this.timeline.listTimelinePage(accountId, conversationId, limit, direction, cursor);
  }

  listConversations(accountId) {
    return this.timeline.listConversations(accountId);
  }

  getPreferences(scope, scopeId) {
    return this.preferences.getPreferences(scope, scopeId);
  }

  updatePreferences(scope, scopeId, values) {
    return this.preferences.updatePreferences(scope, scopeId, values);
  }

  resetPreferences(scope, scopeId) {
    return this.preferences.resetPreferences(scope, scopeId);
  }

  close() {
    this.database.close();
  }
}

module.exports = { PersistenceStore };
