import { InjectionToken } from '@angular/core';
import {
  CertificateTrustDecisionInput,
  AttentionClearRequest,
  AttentionRequest,
  BroadcastSendInput,
  BroadcastSendResult,
  ChatStateInput,
  ConnectInput,
  ConnectionState,
  Contact,
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
  StickerMessageRef,
  StickerSendRequest,
  HistoryPage,
  HistoryPageInput,
  MediaListInput,
  Message,
  MessageSendInput,
  MucDiscoverInput,
  MucJoinInput,
  MucLeaveInput,
  MucSendInput,
  Presence,
  PresenceInput,
  Preferences,
  Result,
  RoomRef,
  RoomSendReceipt,
  RoomState,
  TypedDomainEvent,
  TimelinePage,
  TimelinePageInput,
  XmppConnectionProfile,
} from './domain';

export interface XmppPort {
  connect(input: ConnectInput): Promise<Result<ConnectionState>>;
  disconnect(accountId: string): Promise<Result<void>>;
  getState(accountId: string): Promise<Result<ConnectionState>>;
  setPresence(input: PresenceInput): Promise<Result<Presence>>;
  listRoster(accountId: string): Promise<Result<Contact[]>>;
  sendMessage(input: MessageSendInput): Promise<Result<Message>>;
  sendChatState?(input: ChatStateInput): Promise<Result<void>>;
  subscribe(listener: (event: TypedDomainEvent) => void): () => void;
}

export interface MucPort {
  discover(input: MucDiscoverInput): Promise<Result<ReadonlyArray<RoomRef>>>;
  join(input: MucJoinInput): Promise<Result<RoomState>>;
  leave(input: MucLeaveInput): Promise<Result<RoomState>>;
  sendRoomMessage(input: MucSendInput): Promise<Result<RoomSendReceipt>>;
  subscribe(listener: (event: TypedDomainEvent) => void): () => void;
}

export interface AccountConfig {
  readonly accountId: string;
  readonly endpoint: ConnectInput['endpoint'];
}

export interface AccountPort {
  isAvailable?(): boolean;
  getConfig(): AccountConfig | undefined;
  listProfiles?(requestId?: string): Promise<Result<ReadonlyArray<XmppConnectionProfile>>>;
  saveProfile?(
    profile: XmppConnectionProfile,
    requestId?: string,
  ): Promise<Result<XmppConnectionProfile>>;
  deleteProfile?(accountId: string, requestId?: string): Promise<Result<void>>;
  forgetSecret?(input: { version: 1; requestId: string; accountId: string }): Promise<Result<void>>;
  setSecret(input: {
    version: 1;
    requestId: string;
    credentialRef: string;
    secret: string;
    accountId?: string;
    remember?: boolean;
  }): Promise<Result<{ stored: true }>>;
}

export interface HistoryPort {
  list(input: {
    version: 1;
    requestId: string;
    accountId: string;
    conversationId: string;
  }): Promise<Result<Message[]>>;
  listPage(input: HistoryPageInput): Promise<Result<HistoryPage>>;
  timelinePage?(input: TimelinePageInput): Promise<Result<TimelinePage>>;
  conversations(input: {
    version: 1;
    requestId: string;
    accountId: string;
  }): Promise<Result<Array<{ accountId: string; jid: string; lastActivity: string }>>>;
}

export interface MediaPort {
  list(input: MediaListInput): Promise<Result<ReadonlyArray<ChatImageRecord>>>;
}

export interface FileHistoryPort {
  open(input: FileHistoryRequest): Promise<Result<void>>;
  reveal(input: FileHistoryRequest): Promise<Result<void>>;
}

export interface PreferencesPort {
  get(input: { accountId: string }): Promise<Result<Preferences>>;
  update(input: {
    accountId: string;
    changes: Partial<Preferences>;
  }): Promise<Result<Partial<Preferences>>>;
  reset(input: { accountId: string }): Promise<Result<Preferences>>;
  selectDownloadDirectory(): Promise<Result<string | null>>;
}

export interface CertificatePort {
  decide(input: CertificateTrustDecisionInput): Promise<Result<void>>;
}

export interface AttentionPort {
  request(input: AttentionRequest): Promise<Result<void>>;
  clear(input: AttentionClearRequest): Promise<Result<void>>;
}

export interface BroadcastPort {
  send(input: BroadcastSendInput): Promise<Result<BroadcastSendResult>>;
}

export interface FileTransferPort {
  send(input: FileSendInput): Promise<Result<FileTransfer | null>>;
  sendDropped(input: FileDroppedSendInput): Promise<Result<FileTransfer | null>>;
  accept(input: FileRequest): Promise<Result<FileTransfer>>;
  reject(input: FileRequest): Promise<Result<FileTransfer>>;
  cancel(input: FileRequest): Promise<Result<FileTransfer>>;
  open(input: FileRequest): Promise<Result<void>>;
  reveal(input: FileRequest): Promise<Result<void>>;
  listActive(input: FileActiveInput): Promise<Result<ReadonlyArray<FileTransfer>>>;
  subscribe(listener: (event: TypedDomainEvent) => void): () => void;
}

export interface PreviewPort {
  get(input: ImagePreviewRequest): Promise<Result<ImagePreviewRef>>;
  open(input: PreviewOpenRequest): Promise<Result<PreviewStreamRef>>;
  read(input: PreviewReadRequest): Promise<Result<PreviewChunk>>;
  close(input: PreviewCloseRequest): Promise<Result<void>>;
  revoke(input: ImagePreviewRevokeRequest): Promise<Result<void>>;
}

export interface StickerLibraryPort {
  import(input: StickerImportRequest): Promise<Result<StickerImportResult | null>>;
  list(input: StickerListRequest): Promise<Result<StickerLibrarySnapshot>>;
  delete(input: StickerDeleteRequest): Promise<Result<void>>;
}

export interface StickerPackPort {
  list(input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>>;
  get(input: StickerPackGetRequest): Promise<Result<StickerPackDTO>>;
  save(input: StickerPackSaveRequest): Promise<Result<StickerPackDTO>>;
  delete(input: StickerPackDeleteRequest): Promise<Result<void>>;
  listDrafts(input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>>;
  createDraft(input: StickerDraftCreateRequest): Promise<Result<StickerDraftDTO>>;
  getDraft(input: StickerDraftGetRequest): Promise<Result<StickerDraftDTO>>;
  updateDraft(input: StickerDraftUpdateRequest): Promise<Result<StickerDraftDTO>>;
  discardDraft(input: StickerDraftDiscardRequest): Promise<Result<void>>;
  commitDraft(input: StickerDraftCommitRequest): Promise<Result<StickerPackDTO>>;
}

export interface StickerPreviewPort {
  get(input: StickerPreviewGetRequest): Promise<Result<StickerPreviewGrant>>;
  open(input: StickerPreviewOpenRequest): Promise<Result<StickerPreviewStreamRef>>;
  read(input: StickerPreviewReadRequest): Promise<Result<StickerPreviewChunk>>;
  close(input: StickerPreviewCloseRequest): Promise<Result<void>>;
  revoke(input: StickerPreviewRevokeRequest): Promise<Result<void>>;
}

export interface StickerMessagePort {
  discover(input: StickerCapabilityRequest): Promise<Result<StickerCapability>>;
  send(input: StickerSendRequest): Promise<Result<StickerMessageRef>>;
  load(input: StickerMessageLoadRequest): Promise<Result<StickerMessageRef>>;
  subscribe(listener: (event: TypedDomainEvent) => void): () => void;
}

export const XMPP_PORT = new InjectionToken<XmppPort>('AtomicChat XmppPort');
export const MUC_PORT = new InjectionToken<MucPort>('AtomicChat MucPort');
export const ACCOUNT_PORT = new InjectionToken<AccountPort>('AtomicChat AccountPort');
export const HISTORY_PORT = new InjectionToken<HistoryPort>('AtomicChat HistoryPort');
export const PREFERENCES_PORT = new InjectionToken<PreferencesPort>('AtomicChat PreferencesPort');
export const CERTIFICATE_PORT = new InjectionToken<CertificatePort>('AtomicChat CertificatePort');
export const ATTENTION_PORT = new InjectionToken<AttentionPort>('AtomicChat AttentionPort');
export const BROADCAST_PORT = new InjectionToken<BroadcastPort>('AtomicChat BroadcastPort');
export const FILE_TRANSFER_PORT = new InjectionToken<FileTransferPort>(
  'AtomicChat FileTransferPort',
);
export const PREVIEW_PORT = new InjectionToken<PreviewPort>('AtomicChat PreviewPort');
export const MEDIA_PORT = new InjectionToken<MediaPort>('AtomicChat MediaPort');
export const FILE_HISTORY_PORT = new InjectionToken<FileHistoryPort>('AtomicChat FileHistoryPort');
export const STICKER_LIBRARY_PORT = new InjectionToken<StickerLibraryPort>('AtomicChat StickerLibraryPort');
export const STICKER_PACK_PORT = new InjectionToken<StickerPackPort>('AtomicChat StickerPackPort');
export const STICKER_PREVIEW_PORT = new InjectionToken<StickerPreviewPort>('AtomicChat StickerPreviewPort');
export const STICKER_MESSAGE_PORT = new InjectionToken<StickerMessagePort>('AtomicChat StickerMessagePort');
