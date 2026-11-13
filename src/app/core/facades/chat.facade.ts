import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  type WritableSignal,
} from '@angular/core';
import { createOpaqueId } from '../ids';
import { MessageSearchStore } from '../stores/message-search.store';
import { IncomingChatStateStore } from '../stores/incoming-chat-state.store';
import { OutgoingChatStateStore } from '../stores/outgoing-chat-state.store';
import { upsertLiveMessage } from '../timeline/conversation-history-window';
import { ConversationHistoryCoordinator } from '../coordinators/conversation-history.coordinator';
import { SessionProfileCoordinator } from '../coordinators/session-profile.coordinator';
import { DirectMessagingCoordinator } from '../coordinators/direct-messaging.coordinator';
import { RosterConversationCoordinator } from '../coordinators/roster-conversation.coordinator';
import { UnreadConversationCoordinator } from '../coordinators/unread-conversation.coordinator';
import {
  CertificateTrustDecision,
  ChatState,
  Message,
  ReactionState,
  MessageSearchHit,
  MessageSearchScope,
  MessageSendInput,
  Presence,
  PresenceInput,
  Preferences,
  Result,
  StickerMessageRef,
  XmppConnectionProfile,
} from '../domain';
import { UnreadStore } from '../stores/unread.store';
import { ActiveConversationStore } from '../stores/active-conversation.store';
import { ConversationVisibilityStore } from '../stores/conversation-visibility.store';
import { WindowFocusStore } from '../stores/window-focus.store';
import { bareJid } from '../identity';
import {
  ACCOUNT_PORT,
  CERTIFICATE_PORT,
  HISTORY_PORT,
  PREFERENCES_PORT,
  XMPP_PORT,
  ATTENTION_PORT,
  AccountPort,
  AttentionPort,
  HistoryPort,
  PreferencesPort,
  XmppPort,
} from '../ports';

export type { InitialHistoryState } from '../coordinators/conversation-history.coordinator';

@Injectable({ providedIn: 'root' })
export class ChatFacade {
  private readonly account = inject<AccountPort>(ACCOUNT_PORT);
  private readonly certificate = inject(CERTIFICATE_PORT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly history = inject<HistoryPort>(HISTORY_PORT);
  private readonly messageSearchStore = inject(MessageSearchStore);
  private readonly incomingChatStateStore = inject(IncomingChatStateStore);
  private readonly outgoingChatStateStore = inject(OutgoingChatStateStore);
  private readonly preferencesPort = inject<PreferencesPort>(PREFERENCES_PORT);
  private readonly xmpp = inject<XmppPort>(XMPP_PORT);
  private readonly unread = inject(UnreadStore);
  private readonly activeConversation = inject(ActiveConversationStore);
  private readonly conversationVisibility = inject(ConversationVisibilityStore);
  private readonly windowFocus = inject(WindowFocusStore);
  private readonly attention = inject<AttentionPort | null>(ATTENTION_PORT, { optional: true });
  private acceptingIncomingEvents = true;
  readonly error = signal<string | null>(null);
  readonly preferences = signal<Preferences>({
    theme: 'atomic',
    notifications: true,
    autoAcceptFileTransfers: false,
    autoLogin: false,
    hideClosedConversations: false,
    fileTransferTimeoutSeconds: 300,
    downloadDirectory: '',
  });
  private readonly session: SessionProfileCoordinator = new SessionProfileCoordinator({
    account: this.account,
    certificate: this.certificate,
    preferences: this.preferencesPort,
    xmpp: this.xmpp,
    isAvailable: () => this.isAvailable(),
    reportError: (message) => this.error.set(message),
    clearError: () => this.error.set(null),
    beforeAccountSwitch: (previousAccount) => {
      this.unreadConversation.resetAccount(previousAccount);
    },
    afterAccountSwitch: (accountId) => {
      this.resetRemotePresence(accountId);
      this.conversationHistory.reset();
    },
    applyPreferences: (changes) =>
      this.preferences.update((current) => ({ ...current, ...changes })),
    setPreferences: (preferences) => this.preferences.set(preferences),
    mergeRoster: (roster) => this.roster.mergeRoster(roster),
    loadStoredConversations: (accountId, generation) =>
      this.roster.loadStoredConversations(accountId, generation),
    loadPreferences: (generation, accountId) => this.loadPreferences(generation, accountId),
    onSessionAuthenticated: () => {
      this.acceptingIncomingEvents = true;
    },
    clearChatStates: () => this.clearChatStates(),
    resetRemotePresence: (accountId) => this.resetRemotePresence(accountId),
  });
  private readonly unreadConversation = new UnreadConversationCoordinator({
    unread: this.unread,
    activeConversation: this.activeConversation,
    windowFocus: this.windowFocus,
    attention: this.attention,
    currentAccountId: () => this.session.accountId(),
  });
  private readonly roster = new RosterConversationCoordinator({
    history: this.history,
    xmpp: this.xmpp,
    unreadCounts: this.unread.counts.asReadonly(),
    accountId: () => this.session.accountId(),
    identityGeneration: () => this.session.identityGeneration(),
    isCurrent: (generation, accountId) => this.session.isCurrent(generation, accountId),
    reportError: (message) => this.error.set(message),
  });
  readonly accountId: WritableSignal<string> = this.session.accountId;
  readonly connection = this.session.connection;
  readonly certificateRequest = this.session.certificateRequest;
  readonly profiles = this.session.profiles;
  readonly contacts = this.roster.contacts;
  readonly conversationSummaries = this.roster.conversationSummaries;
  readonly presence = signal<Presence>({
    jid: this.accountId(),
    availability: 'available',
    updatedAt: new Date().toISOString(),
  });
  readonly isConnected = computed(() => this.connection().status === 'connected');
  private readonly conversationHistory = new ConversationHistoryCoordinator({
    history: this.history,
    search: this.messageSearchStore,
    accountId: () => this.accountId(),
    identityGeneration: () => this.session.identityGeneration(),
    isAvailable: () => this.isAvailable(),
    reportError: (message) => this.error.set(message),
    markConversationRead: (accountId, conversationId) =>
      this.markHistoryConversationRead(accountId, conversationId),
  });
  private readonly messaging = new DirectMessagingCoordinator({
    messages: this.conversationHistory.messages,
    accountId: () => this.accountId(),
    isConnected: () => this.isConnected(),
    xmpp: this.xmpp,
    incomingChatState: this.incomingChatStateStore,
    outgoingChatState: this.outgoingChatStateStore,
    reportError: (message) => this.error.set(message),
    upsertMessage: (message, conversationId) => this.upsertMessage(message, conversationId),
  });
  readonly messages = this.conversationHistory.messages;
  readonly messageSearchResults = this.conversationHistory.messageSearchResults;
  readonly messageSearchLoading = this.conversationHistory.messageSearchLoading;
  readonly messageSearchError = this.conversationHistory.messageSearchError;
  readonly messageSearchHasMore = this.conversationHistory.messageSearchHasMore;
  readonly timelineItems = this.conversationHistory.timelineItems;
  readonly timelineSupported = this.conversationHistory.timelineSupported;
  readonly initialHistory = this.conversationHistory.initialHistory;
  readonly historyLoading = this.conversationHistory.historyLoading;
  readonly hasOlderMessages = this.conversationHistory.hasOlderMessages;
  readonly hasNewerMessages = this.conversationHistory.hasNewerMessages;
  readonly preferencesLoaded = signal(false);
  readonly unreadCounts = this.unread.counts.asReadonly();
  readonly unreadTotal = this.unread.total;
  readonly chatStates = this.incomingChatStateStore.states;
  readonly reactions = this.messaging.reactions;
  private readonly accountContactReset = effect(() => {
    const accountId = this.accountId();
    this.messaging.resetForAccount();
    this.roster.resetForAccount(accountId);
    this.conversationHistory.resetSearch();
  });
  private readonly reactionReconciler = effect(() => {
    this.messaging.pendingReactionVersion();
    this.messages();
    this.messaging.reconcilePendingMessages();
  });

  constructor() {
    const unsubscribe = this.xmpp.subscribe((event) => {
      if (event.type === 'certificate.trustRequired') {
        this.session.handleCertificateTrustRequired(event.payload);
      }
      if (event.type === 'connection.stateChanged') {
        if (this.session.handleConnectionStateChanged(event.payload))
          this.acceptingIncomingEvents = event.payload.status === 'connected';
      }
      if (event.type !== 'certificate.trustRequired' && event.type !== 'connection.stateChanged')
        if (!this.acceptingIncomingEvents) return;
      if (event.type === 'presence.changed') {
        const presence = event.payload;
        if (presence.accountId && presence.accountId !== this.accountId()) return;
        if (presence.jid === this.accountId()) this.presence.set(presence);
        else if (presence.accountId === this.accountId()) {
          this.roster.applyRemoteContactPresence(presence);
        }
      }
      if (event.type === 'message.stateChanged' || event.type === 'message.received') {
        const message = event.payload;
        if (message.accountId === this.accountId()) {
          this.upsertMessage(message, message.conversationId || message.senderJid);
          if (event.type === 'message.received' && !this.isOwnMessage(message)) {
            const conversationId = message.conversationId || message.senderJid;
            this.conversationVisibility.reveal(message.accountId, 'direct', conversationId);
            this.unreadConversation.recordIncoming({
              accountId: message.accountId,
              kind: 'direct',
              conversationId,
              messageIdentity: message.clientMessageId || message.id,
            });
            this.roster.updateConversationUnread(message.accountId, conversationId);
          }
        }
      }
      if (event.type === 'reaction.changed') {
        this.messaging.handleReactionChanged(event.payload);
      }
      if (event.type === 'reaction.rejected') this.messaging.handleReactionRejected(event.payload);
      if (event.type === 'sticker.messageReceived' || event.type === 'sticker.stateChanged') {
        const sticker = event.payload;
        if (sticker.accountId === this.accountId()) this.upsertStickerMessage(sticker);
      }
      if (event.type === 'chatState.changed') this.messaging.handleChatStateChanged(event.payload);
    });
    this.destroyRef.onDestroy(() => {
      unsubscribe();
      this.clearChatStates();
    });
  }

  async decideCertificate(decision: CertificateTrustDecision): Promise<void> {
    await this.session.decideCertificate(decision);
  }

  async tryAutoLogin(): Promise<void> {
    await this.session.tryAutoLogin();
  }

  async loadProfiles(): Promise<ReadonlyArray<XmppConnectionProfile>> {
    return this.session.loadProfiles();
  }

  async getProfilePreferences(accountId: string): Promise<Preferences | undefined> {
    return this.session.getProfilePreferences(accountId);
  }

  async saveProfile(
    profile: XmppConnectionProfile,
  ): Promise<Result<XmppConnectionProfile> | undefined> {
    return this.session.saveProfile(profile);
  }

  async forgetSecret(accountId: string): Promise<boolean> {
    return this.session.forgetSecret(accountId);
  }

  async recoverSecretStorage(accountId: string): Promise<boolean> {
    return this.session.recoverSecretStorage(accountId);
  }

  async resetSecretStorage(accountId: string): Promise<boolean> {
    return this.session.resetSecretStorage(accountId);
  }

  async deleteProfile(accountId: string): Promise<boolean> {
    return this.session.deleteProfile(accountId);
  }

  async connect(
    accountId = this.accountId(),
    secret = '',
    options?: {
      profile?: XmppConnectionProfile;
      domain?: string;
      mode?: 'automatic' | 'manual';
      manualEndpoint?: XmppConnectionProfile['manualEndpoint'];
      remember?: boolean;
      autoLogin?: boolean;
      autoLoginExplicit?: boolean;
    },
  ): Promise<boolean> {
    this.acceptingIncomingEvents = false;
    const generation = this.session.identityGeneration() + 1;
    const requestedAccount = accountId.trim();
    const connected = await this.session.connect(accountId, secret, options);
    if (generation === this.session.identityGeneration() && requestedAccount === this.accountId())
      this.acceptingIncomingEvents = connected;
    return connected;
  }

  async disconnect(): Promise<void> {
    this.acceptingIncomingEvents = false;
    await this.session.disconnect();
    this.acceptingIncomingEvents = this.isConnected();
  }

  async refreshState(): Promise<void> {
    await this.session.refreshState();
  }

  async refreshRoster(): Promise<void> {
    await this.roster.refreshRoster();
  }

  async loadConversation(
    conversationId: string,
    options?: { readonly deferInitialReady?: boolean },
  ): Promise<void> {
    await this.conversationHistory.loadConversation(conversationId, options);
  }

  searchMessages(query: string, scope: MessageSearchScope, append = false): Promise<void> {
    return this.conversationHistory.searchMessages(query, scope, append);
  }

  async revealSearchHit(hit: MessageSearchHit): Promise<void> {
    await this.conversationHistory.revealSearchHit(hit);
  }

  async loadOlderMessages(conversationId: string): Promise<void> {
    await this.conversationHistory.loadOlderMessages(conversationId);
  }

  async loadNewerMessages(conversationId: string): Promise<void> {
    await this.conversationHistory.loadNewerMessages(conversationId);
  }

  async loadPreferences(
    generation: number | undefined,
    accountId = this.accountId(),
  ): Promise<void> {
    if (!this.isAvailable()) return;
    const currentGeneration = generation ?? this.session.identityGeneration();
    await this.roster.loadStoredConversations(accountId, currentGeneration);
    const result = await this.preferencesPort.get({ accountId });
    if (!this.isCurrent(currentGeneration, accountId)) return;
    if (result.ok) this.preferences.set(result.value);
    else this.error.set(result.error.message);
    this.preferencesLoaded.set(true);
  }

  async updatePreferences(changes: Partial<Preferences>): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const result = await this.preferencesPort.update({ accountId: this.accountId(), changes });
    if (result.ok) {
      this.preferences.update((current) => ({ ...current, ...result.value }));
      return true;
    }
    this.error.set(result.error.message);
    return false;
  }

  async resetPreferences(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    const result = await this.preferencesPort.reset({ accountId: this.accountId() });
    if (result.ok) {
      this.preferences.set(result.value);
      this.preferencesLoaded.set(true);
      return true;
    }
    this.error.set(result.error.message);
    return false;
  }

  selectDownloadDirectory(): Promise<Result<string | null>> {
    return this.preferencesPort.selectDownloadDirectory();
  }

  async setPresence(mode: PresenceInput['mode'], status = ''): Promise<void> {
    const result = await this.xmpp.setPresence({
      version: 1,
      requestId: createOpaqueId('req'),
      accountId: this.accountId(),
      availability: 'available',
      mode,
      status: status || undefined,
    });
    if (result.ok) this.presence.set(result.value);
    else this.error.set(result.error.message);
  }

  async setAvailability(availability: PresenceInput['availability']): Promise<void> {
    return this.setPresence(availability === 'unavailable' ? 'away' : undefined);
  }

  async send(text: string, conversationId: string): Promise<boolean> {
    return this.messaging.send(text, conversationId);
  }

  async sendMessageWithReply(
    text: string,
    conversationId: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    return this.messaging.sendMessageWithReply(text, conversationId, replyToMessageId);
  }

  async sendReaction(
    conversationId: string,
    targetMessageId: string,
    emojis: ReadonlyArray<string>,
  ): Promise<boolean> {
    return this.messaging.sendReaction(conversationId, targetMessageId, emojis);
  }

  upsertStickerMessage(sticker: StickerMessageRef): void {
    const activeConversation = this.conversationHistory.activeConversationId();
    if (activeConversation && bareJid(sticker.conversationId) !== activeConversation) {
      this.roster.addConversation(
        sticker.accountId,
        sticker.conversationId,
        Date.parse(sticker.createdAt),
      );
      return;
    }
    this.timelineItems.update((items) => {
      const next = items.filter(
        (item) => item.kind !== 'sticker' || item.sticker.refId !== sticker.refId,
      );
      next.push({
        kind: 'sticker',
        id: `sticker:${sticker.refId}`,
        sortAt: sticker.createdAt,
        sticker,
      });
      return next
        .sort(
          (left, right) =>
            left.sortAt.localeCompare(right.sortAt) || left.id.localeCompare(right.id),
        )
        .slice(-200);
    });
    this.roster.addConversation(
      sticker.accountId,
      sticker.conversationId,
      Date.parse(sticker.createdAt),
    );
  }

  async sendMessageInput(input: MessageSendInput): Promise<Result<Message>> {
    return this.messaging.sendMessageInput(input);
  }

  reactionFor(conversationId: string, messageId: string): ReactionState | undefined {
    return this.messaging.reactionFor(conversationId, messageId);
  }

  async updateTypingState(conversationId: string, draft: string): Promise<void> {
    await this.messaging.updateTypingState(conversationId, draft);
  }

  async setTypingActivity(
    conversationId: string,
    state: Extract<ChatState, 'active' | 'inactive'>,
  ): Promise<void> {
    await this.messaging.setTypingActivity(conversationId, state);
  }

  markConversationRead(conversationId: string): void {
    this.markHistoryConversationRead(this.accountId(), conversationId);
  }

  private markHistoryConversationRead(accountId: string, conversationId: string): void {
    this.unreadConversation.markConversationRead(accountId, 'direct', conversationId);
  }

  private isCurrent(generation: number, accountId: string): boolean {
    return this.session.isCurrent(generation, accountId);
  }

  private isAvailable(): boolean {
    return this.account.isAvailable?.() ?? Boolean(this.account.getConfig());
  }

  private resetRemotePresence(accountId: string): void {
    const updatedAt = new Date().toISOString();
    this.presence.set({ jid: accountId, availability: 'unknown', updatedAt });
    this.roster.resetRemotePresence(accountId);
  }

  private upsertMessage(message: Message, conversationId?: string): void {
    const activeConversation = this.conversationHistory.activeConversationId();
    if (activeConversation && bareJid(message.conversationId) !== activeConversation) {
      if (conversationId) this.roster.addConversation(message.accountId, conversationId);
      return;
    }
    this.messages.update((items) => upsertLiveMessage(items, message));
    if (conversationId)
      this.roster.addConversation(message.accountId, conversationId, Date.parse(message.createdAt));
  }

  private isOwnMessage(message: Message): boolean {
    return bareJid(message.senderJid) === bareJid(message.accountId);
  }

  private clearChatStates(): void {
    this.messaging.clearChatStates();
  }
}
