import { Injectable } from '@angular/core';
import {
  AttentionClearRequest,
  AttentionRequest,
  BroadcastSendInput,
  BroadcastSendResult,
  CertificateTrustDecisionInput,
  FileActiveInput,
  FileRequest,
  FileSendInput,
  FileDroppedSendInput,
  FileTransfer,
  ChatImageRecord,
  FileHistoryRequest,
  ImagePreviewRequest,
  ImagePreviewRef,
  ImagePreviewRevokeRequest,
  HistoryPage,
  HistoryPageInput,
  MediaListInput,
  Message,
  Preferences,
  PreviewChunk,
  PreviewCloseRequest,
  PreviewOpenRequest,
  PreviewReadRequest,
  PreviewStreamRef,
  StickerDeleteRequest,
  StickerDraftCommitRequest,
  StickerDraftCreateRequest,
  StickerDraftDiscardRequest,
  StickerDraftDTO,
  StickerDraftGetRequest,
  StickerDraftListSnapshot,
  StickerDraftUpdateRequest,
  StickerImportRequest,
  StickerImportResult,
  StickerLibrarySnapshot,
  StickerPackDTO,
  StickerPackDeleteRequest,
  StickerPackGetRequest,
  StickerPackListRequest,
  StickerPackListSnapshot,
  StickerPackSaveRequest,
  StickerListRequest,
  StickerPreviewChunk,
  StickerPreviewCloseRequest,
  StickerPreviewGetRequest,
  StickerPreviewGrant,
  StickerPreviewOpenRequest,
  StickerPreviewReadRequest,
  StickerPreviewRevokeRequest,
  StickerPreviewStreamRef,
  StickerCapability,
  StickerCapabilityRequest,
  StickerMessageLoadRequest,
  StickerMessageSaveRequest,
  StickerMessageRef,
  StickerSendRequest,
  Result,
  TypedDomainEvent,
  TimelinePage,
  TimelinePageInput,
  XmppConnectionProfile,
} from './domain';
import { subscribeToDomainEvents } from './domain-event.validation';
import { getAtomicChatApi } from './electron-api';
import {
  AccountConfig,
  AccountPort,
  AttentionPort,
  BroadcastPort,
  CertificatePort,
  FileTransferPort,
  HistoryPort,
  MediaPort,
  FileHistoryPort,
  PreferencesPort,
  PreviewPort,
  StickerLibraryPort,
  StickerPackPort,
  StickerPreviewPort,
  StickerMessagePort,
} from './ports';

const unavailable = <T>(requestId: string): Result<T> => ({
  ok: false,
  version: 1,
  error: {
    code: 'UNSUPPORTED',
    retryable: false,
    requestId,
    message: 'La API de Electron no está disponible.',
  },
});

@Injectable({ providedIn: 'root' })
export class ElectronAccountPort implements AccountPort {
  isAvailable(): boolean {
    return getAtomicChatApi() !== undefined;
  }
  getConfig(): AccountConfig | undefined {
    return getAtomicChatApi()?.config;
  }

  listProfiles(requestId = 'profiles-list'): Promise<Result<ReadonlyArray<XmppConnectionProfile>>> {
    const api = getAtomicChatApi();
    return api
      ? api.connectionProfiles.list({ version: 1, requestId })
      : Promise.resolve(unavailable(requestId));
  }

  saveProfile(
    profile: XmppConnectionProfile,
    requestId = 'profiles-save',
  ): Promise<Result<XmppConnectionProfile>> {
    const api = getAtomicChatApi();
    return api
      ? api.connectionProfiles.save({ version: 1, requestId, profile })
      : Promise.resolve(unavailable(requestId));
  }

  deleteProfile(accountId: string, requestId = 'profiles-delete'): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api
      ? api.connectionProfiles.delete({ version: 1, requestId, accountId })
      : Promise.resolve(unavailable(requestId));
  }

  forgetSecret(input: { version: 1; requestId: string; accountId: string }): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.account.forgetSecret(input) : Promise.resolve(unavailable(input.requestId));
  }

  setSecret(input: {
    version: 1;
    requestId: string;
    credentialRef: string;
    secret: string;
    accountId?: string;
    remember?: boolean;
  }): Promise<Result<{ stored: true }>> {
    const api = getAtomicChatApi();
    return api ? api.account.setSecret(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronHistoryPort implements HistoryPort {
  list(input: {
    version: 1;
    requestId: string;
    accountId: string;
    conversationId: string;
  }): Promise<Result<Message[]>> {
    const api = getAtomicChatApi();
    return api ? api.history.list(input) : Promise.resolve(unavailable(input.requestId));
  }

  listPage(input: HistoryPageInput): Promise<Result<HistoryPage>> {
    const api = getAtomicChatApi();
    return api ? api.history.listPage(input) : Promise.resolve(unavailable(input.requestId));
  }

  timelinePage(input: TimelinePageInput): Promise<Result<TimelinePage>> {
    const api = getAtomicChatApi();
    return api ? api.history.timelinePage(input) : Promise.resolve(unavailable(input.requestId));
  }

  conversations(input: {
    version: 1;
    requestId: string;
    accountId: string;
  }): Promise<Result<Array<{ accountId: string; jid: string; lastActivity: string }>>> {
    const api = getAtomicChatApi();
    return api ? api.history.conversations(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronMediaPort implements MediaPort {
  list(input: MediaListInput): Promise<Result<ReadonlyArray<ChatImageRecord>>> {
    const api = getAtomicChatApi();
    return api ? api.media.list(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronFileHistoryPort implements FileHistoryPort {
  open(input: FileHistoryRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.fileHistory.open(input) : Promise.resolve(unavailable(input.requestId));
  }

  reveal(input: FileHistoryRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.fileHistory.reveal(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronPreferencesPort implements PreferencesPort {
  get(input: { accountId: string }): Promise<Result<Preferences>> {
    const api = getAtomicChatApi();
    return api ? api.preferences.get(input) : Promise.resolve(unavailable('preferences-get'));
  }

  update(input: {
    accountId: string;
    changes: Partial<Preferences>;
  }): Promise<Result<Partial<Preferences>>> {
    const api = getAtomicChatApi();
    return api ? api.preferences.update(input) : Promise.resolve(unavailable('preferences-update'));
  }

  reset(input: { accountId: string }): Promise<Result<Preferences>> {
    const api = getAtomicChatApi();
    return api ? api.preferences.reset(input) : Promise.resolve(unavailable('preferences-reset'));
  }

  selectDownloadDirectory(): Promise<Result<string | null>> {
    const api = getAtomicChatApi();
    return api
      ? api.preferences.selectDownloadDirectory()
      : Promise.resolve(unavailable('preferences-select-download-directory'));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronCertificatePort implements CertificatePort {
  decide(input: CertificateTrustDecisionInput): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.certificate.decide(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronAttentionPort implements AttentionPort {
  request(input: AttentionRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.attention.request(input) : Promise.resolve(unavailable(input.requestId));
  }

  clear(input: AttentionClearRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.attention.clear(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronBroadcastPort implements BroadcastPort {
  send(input: BroadcastSendInput): Promise<Result<BroadcastSendResult>> {
    const api = getAtomicChatApi();
    return api ? api.broadcast.send(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronFileTransferPort implements FileTransferPort {
  send(input: FileSendInput): Promise<Result<FileTransfer | null>> {
    const api = getAtomicChatApi();
    return api ? api.file.send(input) : Promise.resolve(unavailable(input.requestId));
  }

  sendDropped(input: FileDroppedSendInput): Promise<Result<FileTransfer | null>> {
    const api = getAtomicChatApi();
    return api ? api.file.sendDropped(input) : Promise.resolve(unavailable(input.requestId));
  }

  accept(input: FileRequest): Promise<Result<FileTransfer>> {
    const api = getAtomicChatApi();
    return api ? api.file.accept(input) : Promise.resolve(unavailable(input.requestId));
  }

  reject(input: FileRequest): Promise<Result<FileTransfer>> {
    const api = getAtomicChatApi();
    return api ? api.file.reject(input) : Promise.resolve(unavailable(input.requestId));
  }

  cancel(input: FileRequest): Promise<Result<FileTransfer>> {
    const api = getAtomicChatApi();
    return api ? api.file.cancel(input) : Promise.resolve(unavailable(input.requestId));
  }

  open(input: FileRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.file.open(input) : Promise.resolve(unavailable(input.requestId));
  }

  reveal(input: FileRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.file.reveal(input) : Promise.resolve(unavailable(input.requestId));
  }

  listActive(input: FileActiveInput): Promise<Result<ReadonlyArray<FileTransfer>>> {
    const api = getAtomicChatApi();
    return api ? api.file.listActive(input) : Promise.resolve(unavailable(input.requestId));
  }

  subscribe(listener: (event: TypedDomainEvent) => void): () => void {
    const subscribe = getAtomicChatApi()?.subscribe;
    return subscribe ? subscribeToDomainEvents(subscribe, listener) : () => undefined;
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronPreviewPort implements PreviewPort {
  get(input: ImagePreviewRequest): Promise<Result<ImagePreviewRef>> {
    const api = getAtomicChatApi();
    return api ? api.preview.get(input) : Promise.resolve(unavailable(input.requestId));
  }
  open(input: PreviewOpenRequest): Promise<Result<PreviewStreamRef>> {
    const api = getAtomicChatApi();
    return api ? api.preview.open(input) : Promise.resolve(unavailable(input.requestId));
  }
  read(input: PreviewReadRequest): Promise<Result<PreviewChunk>> {
    const api = getAtomicChatApi();
    return api ? api.preview.read(input) : Promise.resolve(unavailable(input.requestId));
  }
  close(input: PreviewCloseRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.preview.close(input) : Promise.resolve(unavailable(input.requestId));
  }
  revoke(input: ImagePreviewRevokeRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.preview.revoke(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronStickerLibraryPort implements StickerLibraryPort {
  import(input: StickerImportRequest): Promise<Result<StickerImportResult | null>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.import(input) : Promise.resolve(unavailable(input.requestId));
  }
  list(input: StickerListRequest): Promise<Result<StickerLibrarySnapshot>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.list(input) : Promise.resolve(unavailable(input.requestId));
  }
  delete(input: StickerDeleteRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.delete(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronStickerPackPort implements StickerPackPort {
  list(input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.list(input) : Promise.resolve(unavailable(input.requestId));
  }
  get(input: StickerPackGetRequest): Promise<Result<StickerPackDTO>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.get(input) : Promise.resolve(unavailable(input.requestId));
  }
  save(input: StickerPackSaveRequest): Promise<Result<StickerPackDTO>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.save(input) : Promise.resolve(unavailable(input.requestId));
  }
  delete(input: StickerPackDeleteRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.delete(input) : Promise.resolve(unavailable(input.requestId));
  }
  listDrafts(input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.drafts.list(input) : Promise.resolve(unavailable(input.requestId));
  }
  createDraft(input: StickerDraftCreateRequest): Promise<Result<StickerDraftDTO>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.drafts.create(input) : Promise.resolve(unavailable(input.requestId));
  }
  getDraft(input: StickerDraftGetRequest): Promise<Result<StickerDraftDTO>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.drafts.get(input) : Promise.resolve(unavailable(input.requestId));
  }
  updateDraft(input: StickerDraftUpdateRequest): Promise<Result<StickerDraftDTO>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.drafts.update(input) : Promise.resolve(unavailable(input.requestId));
  }
  discardDraft(input: StickerDraftDiscardRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.drafts.discard(input) : Promise.resolve(unavailable(input.requestId));
  }
  commitDraft(input: StickerDraftCommitRequest): Promise<Result<StickerPackDTO>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.packs.drafts.commit(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronStickerPreviewPort implements StickerPreviewPort {
  get(input: StickerPreviewGetRequest): Promise<Result<StickerPreviewGrant>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.preview.get(input) : Promise.resolve(unavailable(input.requestId));
  }
  open(input: StickerPreviewOpenRequest): Promise<Result<StickerPreviewStreamRef>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.preview.open(input) : Promise.resolve(unavailable(input.requestId));
  }
  read(input: StickerPreviewReadRequest): Promise<Result<StickerPreviewChunk>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.preview.read(input) : Promise.resolve(unavailable(input.requestId));
  }
  close(input: StickerPreviewCloseRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.preview.close(input) : Promise.resolve(unavailable(input.requestId));
  }
  revoke(input: StickerPreviewRevokeRequest): Promise<Result<void>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.preview.revoke(input) : Promise.resolve(unavailable(input.requestId));
  }
}

@Injectable({ providedIn: 'root' })
export class ElectronStickerMessagePort implements StickerMessagePort {
  discover(input: StickerCapabilityRequest): Promise<Result<StickerCapability>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.messages.discover(input) : Promise.resolve(unavailable(input.requestId));
  }
  send(input: StickerSendRequest): Promise<Result<StickerMessageRef>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.messages.send(input) : Promise.resolve(unavailable(input.requestId));
  }
  load(input: StickerMessageLoadRequest): Promise<Result<StickerMessageRef>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.messages.load(input) : Promise.resolve(unavailable(input.requestId));
  }
  save(input: StickerMessageSaveRequest): Promise<Result<StickerMessageRef>> {
    const api = getAtomicChatApi();
    return api ? api.stickers.messages.save(input) : Promise.resolve(unavailable(input.requestId));
  }
  subscribe(listener: (event: TypedDomainEvent) => void): () => void {
    const subscribe = getAtomicChatApi()?.subscribe;
    return subscribe ? subscribeToDomainEvents(subscribe, listener) : () => undefined;
  }
}
