export type ContractVersion = 1;
export type RequestId = string;
export type ClientMessageId = string;
export type Availability = 'available' | 'unavailable';
export type PresenceMode = 'chat' | 'away' | 'dnd' | 'xa';
export type ConnectionStatus = 'idle' | 'connecting' | 'authenticating' | 'connected' | 'disconnecting' | 'failed';
export type MessageStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed';
export interface ConnectionState { accountId: string; status: ConnectionStatus; reason?: string; retryable: boolean; since: string; }
export interface Presence { jid: string; availability: Availability; mode?: PresenceMode; status?: string; updatedAt: string; }
export interface Contact { jid: string; name?: string; groups: string[]; presence?: Presence; }
export interface Message { id: string; conversationId: string; clientMessageId: ClientMessageId; senderJid: string; body: { kind: 'text'; text: string }; status: MessageStatus; createdAt: string; errorCode?: AppError['code']; }
export type AppErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'NOT_CONNECTED' | 'TIMEOUT' | 'AUTH_FAILED' | 'TRANSPORT_FAILED' | 'CONFLICT' | 'STORAGE_FAILED' | 'UNSUPPORTED' | 'INTERNAL';
export interface AppError { code: AppErrorCode; retryable: boolean; requestId: RequestId; message: string; }
export type Result<T> = { ok: true; value: T; version: ContractVersion; requestId: RequestId } | { ok: false; error: AppError; version: ContractVersion };
export interface DomainEvent<T> { version: ContractVersion; eventId: string; correlationId?: RequestId | ClientMessageId; type: 'connection.stateChanged' | 'presence.changed' | 'roster.changed' | 'message.stateChanged' | 'message.received'; payload: T; }
export interface ConnectInput { version: ContractVersion; requestId: RequestId; accountId: string; endpoint: { host: string; port: number; tls: boolean }; credentialRef?: string; }
export interface PresenceInput { version: ContractVersion; requestId: RequestId; accountId: string; availability: Availability; mode?: PresenceMode; status?: string; }
export interface MessageSendInput { version: ContractVersion; requestId: RequestId; conversationId: string; clientMessageId: ClientMessageId; body: { kind: 'text'; text: string }; }
export interface Preferences { theme: 'atomic'; notifications: boolean; autoLogin: boolean; }
