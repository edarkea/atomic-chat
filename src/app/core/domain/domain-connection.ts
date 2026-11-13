import type {
  Availability,
  ConnectionMode,
  ConnectionStatus,
  ContractVersion,
  PresenceMode,
  RequestId,
  XmppTransport,
} from './domain-primitives';

export interface ManualXmppEndpoint {
  host: string;
  port: number;
  transport: XmppTransport;
}

export type CredentialStorageStatus =
  'available' | 'recovery_available' | 'corrupt' | 'unavailable';

export interface XmppConnectionProfile {
  accountId: string;
  domain: string;
  mode: ConnectionMode;
  manualEndpoint?: ManualXmppEndpoint;
  updatedAt: string;
  hasPersistentCredential?: boolean;
  credentialStorageStatus?: CredentialStorageStatus;
}

export interface ConnectionState {
  readonly displayName?: string;
  accountId: string;
  status: ConnectionStatus;
  reason?: string;
  retryable: boolean;
  since: string;
}

export interface Presence {
  jid: string;
  availability: Availability;
  mode?: PresenceMode;
  status?: string;
  updatedAt: string;
}

export type RosterSubscription = 'none' | 'to' | 'from' | 'both';

export interface Contact {
  jid: string;
  name?: string;
  groups: string[];
  presence?: Presence;
  subscription?: RosterSubscription;
  ask?: 'subscribe';
  source?: 'roster' | 'conversation';
}

export interface ConnectInput {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  endpoint?: {
    host: string;
    port: number;
    tls: boolean;
    transport?: XmppTransport;
    domain?: string;
    allowInsecureTls?: boolean;
  };
  profileId?: string;
  profileDomain?: string;
  credentialRef?: string;
}

export interface PresenceInput {
  version: 1;
  requestId: RequestId;
  accountId: string;
  availability: Exclude<Availability, 'unknown'>;
  mode?: PresenceMode;
  status?: string;
}
