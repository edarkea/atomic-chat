import { CertificateTrustDecisionInput, ConnectInput, ConnectionState, Contact, DomainEvent, FileActiveInput, FileRequest, FileSendInput, FileTransfer, HistoryPage, HistoryPageInput, Message, MessageSendInput, MucDiscoverInput, MucJoinInput, MucLeaveInput, MucSendInput, Presence, PresenceInput, Preferences, Result, RoomRef, RoomSendReceipt, RoomState, XmppTransport } from './domain';

export interface AtomicChatApi {
  config: { accountId: string; endpoint: { host: string; domain: string; port: number; tls: boolean; transport: XmppTransport; allowInsecureTls: boolean } };
  account: {
    setSecret(input: { version: 1; requestId: string; credentialRef: string; secret: string }): Promise<Result<{ stored: true }>>;
    connect(input: ConnectInput): Promise<Result<ConnectionState>>;
    disconnect(accountId: string): Promise<Result<void>>;
  };
  certificate: { decide(input: CertificateTrustDecisionInput): Promise<Result<void>> };
  session: { getState(accountId: string): Promise<Result<ConnectionState>> };
  presence: { set(input: PresenceInput): Promise<Result<Presence>> };
  roster: { list(accountId: string): Promise<Result<Contact[]>> };
  messaging: { send(input: MessageSendInput): Promise<Result<Message>> };
  muc: { discover(input: MucDiscoverInput): Promise<Result<ReadonlyArray<RoomRef>>>; join(input: MucJoinInput): Promise<Result<RoomState>>; leave(input: MucLeaveInput): Promise<Result<RoomState>>; sendMessage(input: MucSendInput): Promise<Result<RoomSendReceipt>> };
  file: { send(input: FileSendInput): Promise<Result<FileTransfer | null>>; accept(input: FileRequest): Promise<Result<FileTransfer>>; reject(input: FileRequest): Promise<Result<FileTransfer>>; cancel(input: FileRequest): Promise<Result<FileTransfer>>; listActive(input: FileActiveInput): Promise<Result<ReadonlyArray<FileTransfer>>> };
  history: { list(input: { version: 1; requestId: string; accountId: string; conversationId: string }): Promise<Result<Message[]>>; listPage(input: HistoryPageInput): Promise<Result<HistoryPage>>; conversations(input: { version: 1; requestId: string; accountId: string }): Promise<Result<Array<{ accountId: string; jid: string; lastActivity: string }>> > };
  preferences: { get(input: { accountId: string }): Promise<Result<Preferences>>; update(input: { accountId: string; changes: Partial<Preferences> }): Promise<Result<Partial<Preferences>>>; reset(input: { accountId: string }): Promise<Result<Preferences>> };
  subscribe(listener: (event: DomainEvent<unknown>) => void): () => void;
}

declare global { interface Window { atomicChat?: AtomicChatApi; } }

export function hasAtomicChatApi(): boolean {
  return typeof window !== 'undefined' && window.atomicChat !== undefined;
}

export function getAtomicChatApi(): AtomicChatApi | undefined {
  return hasAtomicChatApi() ? window.atomicChat : undefined;
}
