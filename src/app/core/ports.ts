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
  ImagePreviewRequest,
  ImagePreviewRef,
  ImagePreviewRevokeRequest,
  PreviewChunk,
  PreviewCloseRequest,
  PreviewOpenRequest,
  PreviewReadRequest,
  PreviewStreamRef,
  HistoryPage,
  HistoryPageInput,
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
  conversations(input: {
    version: 1;
    requestId: string;
    accountId: string;
  }): Promise<Result<Array<{ accountId: string; jid: string; lastActivity: string }>>>;
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
