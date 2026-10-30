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
  MediaListInput,
  HistoryPage,
  HistoryPageInput,
  TimelinePage,
  TimelinePageInput,
  Message,
  MessageSendInput,
  MucDiscoverInput,
  MucJoinInput,
  MucLeaveInput,
  MucSendInput,
  Presence,
  PreviewChunk,
  PreviewCloseRequest,
  PreviewOpenRequest,
  PreviewReadRequest,
  PreviewStreamRef,
  PresenceInput,
  Preferences,
  Result,
  RoomRef,
  RoomSendReceipt,
  RoomState,
  XmppConnectionProfile,
  XmppTransport,
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
} from './domain';

export interface AtomicChatApi {
  config?: {
    accountId: string;
    endpoint: {
      host: string;
      domain: string;
      port: number;
      tls: boolean;
      transport: XmppTransport;
      allowInsecureTls: boolean;
    };
  };
  account: {
    setSecret(input: {
      version: 1;
      requestId: string;
      credentialRef: string;
      secret: string;
      accountId?: string;
      remember?: boolean;
    }): Promise<Result<{ stored: true }>>;
    connect(input: ConnectInput): Promise<Result<ConnectionState>>;
    disconnect(accountId: string): Promise<Result<void>>;
    forgetSecret(input: {
      version: 1;
      requestId: string;
      accountId: string;
    }): Promise<Result<void>>;
  };
  connectionProfiles: {
    list(input: {
      version: 1;
      requestId: string;
    }): Promise<Result<ReadonlyArray<XmppConnectionProfile>>>;
    save(input: {
      version: 1;
      requestId: string;
      profile: XmppConnectionProfile;
    }): Promise<Result<XmppConnectionProfile>>;
    delete(input: { version: 1; requestId: string; accountId: string }): Promise<Result<void>>;
  };
  certificate: { decide(input: CertificateTrustDecisionInput): Promise<Result<void>> };
  attention: {
    request(input: AttentionRequest): Promise<Result<void>>;
    clear(input: AttentionClearRequest): Promise<Result<void>>;
  };
  broadcast: { send(input: BroadcastSendInput): Promise<Result<BroadcastSendResult>> };
  session: { getState(accountId: string): Promise<Result<ConnectionState>> };
  presence: { set(input: PresenceInput): Promise<Result<Presence>> };
  roster: { list(accountId: string): Promise<Result<Contact[]>> };
  messaging: { send(input: MessageSendInput): Promise<Result<Message>> };
  chatState: { send(input: ChatStateInput): Promise<Result<void>> };
  muc: {
    discover(input: MucDiscoverInput): Promise<Result<ReadonlyArray<RoomRef>>>;
    join(input: MucJoinInput): Promise<Result<RoomState>>;
    leave(input: MucLeaveInput): Promise<Result<RoomState>>;
    sendMessage(input: MucSendInput): Promise<Result<RoomSendReceipt>>;
  };
  file: {
    send(input: FileSendInput): Promise<Result<FileTransfer | null>>;
    sendDropped(input: FileDroppedSendInput): Promise<Result<FileTransfer | null>>;
    accept(input: FileRequest): Promise<Result<FileTransfer>>;
    reject(input: FileRequest): Promise<Result<FileTransfer>>;
    cancel(input: FileRequest): Promise<Result<FileTransfer>>;
    open(input: FileRequest): Promise<Result<void>>;
    reveal(input: FileRequest): Promise<Result<void>>;
    listActive(input: FileActiveInput): Promise<Result<ReadonlyArray<FileTransfer>>>;
  };
  preview: {
    get(input: ImagePreviewRequest): Promise<Result<ImagePreviewRef>>;
    open(input: PreviewOpenRequest): Promise<Result<PreviewStreamRef>>;
    read(input: PreviewReadRequest): Promise<Result<PreviewChunk>>;
    close(input: PreviewCloseRequest): Promise<Result<void>>;
    revoke(input: ImagePreviewRevokeRequest): Promise<Result<void>>;
  };
  stickers: {
    import(input: StickerImportRequest): Promise<Result<StickerImportResult | null>>;
    list(input: StickerListRequest): Promise<Result<StickerLibrarySnapshot>>;
    delete(input: StickerDeleteRequest): Promise<Result<void>>;
    preview: {
      get(input: StickerPreviewGetRequest): Promise<Result<StickerPreviewGrant>>;
      open(input: StickerPreviewOpenRequest): Promise<Result<StickerPreviewStreamRef>>;
      read(input: StickerPreviewReadRequest): Promise<Result<StickerPreviewChunk>>;
      close(input: StickerPreviewCloseRequest): Promise<Result<void>>;
      revoke(input: StickerPreviewRevokeRequest): Promise<Result<void>>;
    };
    messages: {
      discover(input: StickerCapabilityRequest): Promise<Result<StickerCapability>>;
      send(input: StickerSendRequest): Promise<Result<StickerMessageRef>>;
      load(input: StickerMessageLoadRequest): Promise<Result<StickerMessageRef>>;
    };
    packs: {
      list(input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>>;
      get(input: StickerPackGetRequest): Promise<Result<StickerPackDTO>>;
      save(input: StickerPackSaveRequest): Promise<Result<StickerPackDTO>>;
      delete(input: StickerPackDeleteRequest): Promise<Result<void>>;
      drafts: {
        list(input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>>;
        create(input: StickerDraftCreateRequest): Promise<Result<StickerDraftDTO>>;
        get(input: StickerDraftGetRequest): Promise<Result<StickerDraftDTO>>;
        update(input: StickerDraftUpdateRequest): Promise<Result<StickerDraftDTO>>;
        discard(input: StickerDraftDiscardRequest): Promise<Result<void>>;
        commit(input: StickerDraftCommitRequest): Promise<Result<StickerPackDTO>>;
      };
    };
  };
  history: {
    list(input: {
      version: 1;
      requestId: string;
      accountId: string;
      conversationId: string;
    }): Promise<Result<Message[]>>;
    listPage(input: HistoryPageInput): Promise<Result<HistoryPage>>;
    timelinePage(input: TimelinePageInput): Promise<Result<TimelinePage>>;
    conversations(input: {
      version: 1;
      requestId: string;
      accountId: string;
    }): Promise<Result<Array<{ accountId: string; jid: string; lastActivity: string }>>>;
  };
  media: {
    list(input: MediaListInput): Promise<Result<ReadonlyArray<ChatImageRecord>>>;
  };
  fileHistory: {
    open(input: FileHistoryRequest): Promise<Result<void>>;
    reveal(input: FileHistoryRequest): Promise<Result<void>>;
  };
  preferences: {
    get(input: { accountId: string }): Promise<Result<Preferences>>;
    update(input: {
      accountId: string;
      changes: Partial<Preferences>;
    }): Promise<Result<Partial<Preferences>>>;
    reset(input: { accountId: string }): Promise<Result<Preferences>>;
    selectDownloadDirectory(): Promise<Result<string | null>>;
  };
  subscribe(listener: (event: unknown) => void): () => void;
}

declare global {
  interface Window {
    atomicChat?: AtomicChatApi;
  }
}

export function hasAtomicChatApi(): boolean {
  return typeof window !== 'undefined' && window.atomicChat !== undefined;
}

export function getAtomicChatApi(): AtomicChatApi | undefined {
  return hasAtomicChatApi() ? window.atomicChat : undefined;
}
