import { ConnectInput, ConnectionState, Contact, DomainEvent, Message, MessageSendInput, Presence, PresenceInput, Preferences, Result } from './domain';

export interface AtomicChatApi {
  config: { endpoint: { host: string; domain: string; port: number; tls: boolean; allowInsecureTls: boolean } };
  account: {
    setSecret(input: { version: 1; requestId: string; credentialRef: string; secret: string }): Promise<Result<{ stored: true }>>;
    connect(input: ConnectInput): Promise<Result<ConnectionState>>;
    disconnect(accountId: string): Promise<Result<void>>;
  };
  session: { getState(accountId: string): Promise<Result<ConnectionState>> };
  presence: { set(input: PresenceInput): Promise<Result<Presence>> };
  roster: { list(accountId: string): Promise<Result<Contact[]>> };
  messaging: { send(input: MessageSendInput): Promise<Result<Message>> };
  history: { list(input: { version: 1; requestId: string; accountId: string; conversationId: string }): Promise<Result<Message[]>> };
  preferences: { get(input: { accountId: string }): Promise<Result<Preferences>>; update(input: { accountId: string; changes: Partial<Preferences> }): Promise<Result<Partial<Preferences>>>; reset(input: { accountId: string }): Promise<Result<Preferences>> };
  subscribe(listener: (event: DomainEvent<unknown>) => void): () => void;
}

declare global { interface Window { atomicChat?: AtomicChatApi; } }
