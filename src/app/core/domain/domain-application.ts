import type { AppError, AppErrorCode } from './domain-errors';
import type { ClientMessageId, ContractVersion, RequestId } from './domain-primitives';

export type Result<T> =
  | { ok: true; value: T; version: ContractVersion; requestId: RequestId }
  | { ok: false; error: AppError; version: ContractVersion };

export type UpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateStatus {
  readonly version: ContractVersion;
  readonly state: UpdateState;
  readonly currentVersion: string;
  readonly availableVersion?: string;
  readonly progressPercent?: number;
  readonly errorCode?: AppErrorCode;
  readonly requestId?: RequestId;
  readonly correlationId?: string;
}

export interface UpdateRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
}

export interface ConversationSummary {
  id: string;
  accountId: string;
  kind: 'direct' | 'muc';
  jid: string;
  title: string;
  unreadCount: number;
  lastMessageAt?: number;
}

export type ActiveConversation = {
  readonly accountId: string;
  readonly kind: 'direct' | 'muc';
  readonly jid: string;
} | null;

export interface AttentionState {
  accountId: string;
  unreadTotal: number;
  attentionRequested: boolean;
}

export interface AttentionRequest {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  conversationId: string;
}

export interface AttentionClearRequest {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
}

export type BroadcastMode = 'normal' | 'alert';

export interface BroadcastRequest {
  readonly broadcastId: RequestId;
  readonly accountId: string;
  readonly mode: BroadcastMode;
  readonly body: string;
  readonly recipientJids: readonly string[];
}

export type BroadcastRecipientStatus = 'submitted' | 'failed' | 'unknown';

export interface BroadcastRecipientResult {
  readonly recipientJid: string;
  readonly clientMessageId: ClientMessageId;
  readonly status: BroadcastRecipientStatus;
  readonly errorCode?: AppErrorCode;
}

export interface BroadcastResult {
  readonly broadcastId: RequestId;
  readonly recipients: readonly BroadcastRecipientResult[];
}

export interface BroadcastSendInput {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly broadcastId: RequestId;
  readonly mode?: BroadcastMode;
  readonly recipientJids: readonly string[];
  readonly body: { readonly kind: 'text'; readonly text: string };
}

export type BroadcastSendResult = BroadcastResult;

export type ThemeId = 'atomic' | 'atomic-light' | 'custom';
export type ThemeColorKey =
  | 'background'
  | 'surface'
  | 'surfaceRaised'
  | 'accent'
  | 'text'
  | 'textSecondary'
  | 'border'
  | 'incomingBubble'
  | 'outgoingBubble'
  | 'focus';
export type HexColor = string;
export type ThemePalette = Readonly<Record<ThemeColorKey, HexColor>>;

export interface Preferences {
  /** Missing in older installations means disabled. */
  closeToTray?: boolean;
  theme: ThemeId;
  customTheme?: ThemePalette;
  notifications: boolean;
  autoAcceptFileTransfers: boolean;
  autoLogin: boolean;
  hideClosedConversations: boolean;
  fileTransferTimeoutSeconds: 60 | 180 | 300 | 600;
  downloadDirectory: string;
}
