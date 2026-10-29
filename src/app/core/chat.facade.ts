import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import {
  CertificateTrustDecision,
  CertificateTrustRequest,
  AttentionClearRequest,
  AttentionRequest,
  ChatState,
  ChatStateInput,
  ConnectionState,
  Contact,
  ConversationSummary,
  Message,
  Presence,
  PresenceInput,
  Preferences,
  Result,
  XmppConnectionProfile,
} from './domain';
import { UnreadStore } from './unread.store';
import {
  ACCOUNT_PORT,
  CERTIFICATE_PORT,
  HISTORY_PORT,
  PREFERENCES_PORT,
  XMPP_PORT,
  ATTENTION_PORT,
  AccountPort,
  AttentionPort,
  CertificatePort,
  HistoryPort,
  PreferencesPort,
  XmppPort,
} from './ports';

interface HistoryContext {
  readonly accountId: string;
  readonly conversationId: string;
  readonly generation: number;
  readonly requestId: string;
}

@Injectable({ providedIn: 'root' })
export class ChatFacade {
  private readonly account = inject<AccountPort>(ACCOUNT_PORT);
  private readonly certificate = inject<CertificatePort>(CERTIFICATE_PORT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly history = inject<HistoryPort>(HISTORY_PORT);
  private readonly preferencesPort = inject<PreferencesPort>(PREFERENCES_PORT);
  private readonly xmpp = inject<XmppPort>(XMPP_PORT);
  private readonly unread = inject(UnreadStore);
  private readonly attention = inject<AttentionPort | null>(ATTENTION_PORT, { optional: true });
  readonly accountId = signal(this.account.getConfig()?.accountId || '');
  readonly connection = signal<ConnectionState>({
    accountId: this.accountId(),
    status: 'idle',
    retryable: false,
    since: new Date().toISOString(),
  });
  readonly contacts = signal<Contact[]>([]);
  readonly conversationSummaries = signal<ReadonlyArray<ConversationSummary>>([]);
  readonly messages = signal<Message[]>([]);
  readonly historyLoading = signal(false);
  readonly hasOlderMessages = signal(false);
  readonly hasNewerMessages = signal(false);
  readonly presence = signal<Presence>({
    jid: this.accountId(),
    availability: 'available',
    updatedAt: new Date().toISOString(),
  });
  readonly isConnected = computed(() => this.connection().status === 'connected');
  readonly error = signal<string | null>(null);
  readonly certificateRequest = signal<CertificateTrustRequest | null>(null);
  readonly preferences = signal<Preferences>({
    theme: 'atomic',
    notifications: true,
    autoLogin: false,
  });
  readonly profiles = signal<ReadonlyArray<XmppConnectionProfile>>([]);
  readonly unreadCounts = this.unread.counts.asReadonly();
  readonly unreadTotal = this.unread.total;
  readonly chatStates = signal<ReadonlyMap<string, ChatState>>(new Map());
  private identityGeneration = 0;
  private contactsOwner = '';
  private olderCursor: string | null = null;
  private newerCursor: string | null = null;
  private historyPages: Array<{ cursor: string }> = [];
  private historyContext: HistoryContext | null = null;
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly typingStates = new Map<string, ChatState>();
  private readonly outgoingChatStates = new Map<string, ChatState>();
  private readonly accountContactReset = effect(() => {
    this.accountId();
    this.contacts.set([]);
    this.conversationSummaries.set([]);
  });

  constructor() {
    const unsubscribe = this.xmpp.subscribe((event) => {
      if (event.type === 'certificate.trustRequired') {
        const request = event.payload;
        if (request.accountId === this.accountId()) this.certificateRequest.set(request);
      }
      if (event.type === 'connection.stateChanged') {
        const state = event.payload;
        if (state.accountId === this.accountId()) this.connection.set(state);
        if (state.accountId === this.accountId() && ['idle', 'failed'].includes(state.status)) {
          this.clearChatStates();
        }
      }
      if (event.type === 'presence.changed') {
        const presence = event.payload;
        if (presence.accountId && presence.accountId !== this.accountId()) return;
        if (presence.jid === this.accountId()) this.presence.set(presence);
        else if (presence.accountId === this.accountId()) {
          this.contacts.update((items) =>
            items.map((contact) =>
              contact.jid === presence.jid &&
              contact.subscription &&
              ['to', 'both'].includes(contact.subscription)
                ? { ...contact, presence }
                : contact,
            ),
          );
        }
      }
      if (event.type === 'message.stateChanged' || event.type === 'message.received') {
        const message = event.payload;
        if (message.accountId === this.accountId()) {
          this.upsertMessage(message, message.conversationId || message.senderJid);
          if (event.type === 'message.received' && !this.isOwnMessage(message)) {
            const incoming = this.unread.recordIncoming(
              message.accountId,
              'direct',
              message.conversationId || message.senderJid,
              message.clientMessageId || message.id,
              this.historyContext?.conversationId === this.bareConversation(message.conversationId),
            );
            if (incoming.isNew) void this.requestAttention(message.accountId, message.conversationId);
          }
        }
      }
      if (event.type === 'chatState.changed') this.receiveChatState(event.payload);
    });
    this.destroyRef.onDestroy(() => {
      unsubscribe();
      this.clearChatStates();
    });
  }

  async decideCertificate(decision: CertificateTrustDecision): Promise<void> {
    const request = this.certificateRequest();
    if (!request || !this.isAvailable()) return;
    try {
      const result = await this.certificate.decide({
        version: 1,
        requestId: request.requestId,
        accountId: request.accountId,
        fingerprintSha256: request.certificate.fingerprintSha256,
        decision,
      });
      if (!result.ok) this.error.set(result.error.message);
      else this.certificateRequest.set(null);
    } catch {
      this.error.set('No fue posible aplicar la decisión del certificado.');
    }
  }

  async tryAutoLogin(): Promise<void> {
    if (!this.isAvailable()) return;
    const listed = await this.loadProfiles();
    if (listed.length) {
      for (const profile of [...listed].sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.accountId.localeCompare(right.accountId),
      )) {
        if (!profile.domain.trim() || profile.hasPersistentCredential !== true) continue;
        const result = await this.preferencesPort.get({ accountId: profile.accountId });
        if (result.ok && result.value.autoLogin) {
          this.preferences.set(result.value);
          await this.connect(profile.accountId, '', {
            profile,
            remember: true,
            autoLogin: true,
            autoLoginExplicit: true,
          });
          return;
        }
      }
      return;
    }
    const accountId = this.accountId();
    if (!accountId) return;
    const result = await this.preferencesPort.get({ accountId });
    if (result.ok && result.value.autoLogin) await this.connect(accountId);
  }

  async loadProfiles(): Promise<ReadonlyArray<XmppConnectionProfile>> {
    const listProfiles = this.account.listProfiles;
    if (!listProfiles) return this.profiles();
    const result = await listProfiles.call(this.account, createOpaqueId('profiles-list'));
    if (result.ok) this.profiles.set(result.value);
    return result.ok ? result.value : [];
  }

  async getProfilePreferences(accountId: string): Promise<Preferences | undefined> {
    if (!this.isAvailable()) return undefined;
    const result = await this.preferencesPort.get({ accountId });
    return result.ok ? result.value : undefined;
  }

  async saveProfile(
    profile: XmppConnectionProfile,
  ): Promise<Result<XmppConnectionProfile> | undefined> {
    if (!this.account.saveProfile) return undefined;
    const result = await this.account.saveProfile(profile, createOpaqueId('profiles-save'));
    if (result.ok) {
      const previous = this.profiles().find((item) => item.accountId === result.value.accountId);
      const saved = {
        ...result.value,
        hasPersistentCredential:
          result.value.hasPersistentCredential ?? previous?.hasPersistentCredential ?? false,
      };
      this.profiles.update((items) => [
        saved,
        ...items.filter((item) => item.accountId !== saved.accountId),
      ]);
      return { ...result, value: saved };
    } else this.error.set(result.error.message);
    return result;
  }

  async forgetSecret(accountId: string): Promise<boolean> {
    const result = await this.account.forgetSecret?.({
      version: 1,
      requestId: createOpaqueId('forget-secret'),
      accountId,
    });
    if (!result) return false;
    if (!result.ok) {
      this.error.set(result.error.message);
      return false;
    }
    this.profiles.update((items) =>
      items.map((item) =>
        item.accountId === accountId ? { ...item, hasPersistentCredential: false } : item,
      ),
    );
    return true;
  }

  async deleteProfile(accountId: string): Promise<boolean> {
    const result = await this.account.deleteProfile?.(accountId, createOpaqueId('profiles-delete'));
    if (!result) return false;
    if (!result.ok) {
      this.error.set(result.error.message);
      return false;
    }
    this.profiles.update((items) => items.filter((profile) => profile.accountId !== accountId));
    return true;
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
    const generation = ++this.identityGeneration;
    const requestedAccount = accountId.trim();
    const previousAccount = this.accountId();
    if (previousAccount && previousAccount !== requestedAccount) {
      this.unread.resetAccount(previousAccount);
      this.clearAttentionIfRead(previousAccount);
    }
    this.error.set(null);
    this.certificateRequest.set(null);
    this.accountId.set(requestedAccount);
    this.messages.set([]);
    this.olderCursor = null;
    this.newerCursor = null;
    this.historyPages = [];
    this.historyContext = null;
    this.hasOlderMessages.set(false);
    this.hasNewerMessages.set(false);
    try {
      const requestId = createOpaqueId('req');
      const credentialRef = `account:${requestedAccount}`;
      const remember = options?.remember ?? true;
      if (!secret.trim() && !remember) {
        this.error.set('Introduce la contraseña para una sesión sin recordar.');
        return false;
      }
      const legacyProfile =
        options?.profile && !options.profile.accountId.includes('@') ? options.profile : undefined;
      const profile =
        legacyProfile ||
        (options?.domain
          ? {
              accountId: requestedAccount,
              domain: options.domain,
              mode: options.mode || 'automatic',
              ...(options.mode === 'manual' && options.manualEndpoint
                ? { manualEndpoint: options.manualEndpoint }
                : {}),
              updatedAt: new Date().toISOString(),
            }
          : undefined);
      if (profile && !legacyProfile && this.account.saveProfile) {
        const saved = await this.account.saveProfile(profile, createOpaqueId('profiles-save'));
        if (!saved.ok) throw new Error(saved.error.message);
        const previous = this.profiles().find((item) => item.accountId === saved.value.accountId);
        const persisted = {
          ...saved.value,
          hasPersistentCredential:
            saved.value.hasPersistentCredential ?? previous?.hasPersistentCredential ?? false,
        };
        this.profiles.update((items) => [
          persisted,
          ...items.filter((item) => item.accountId !== persisted.accountId),
        ]);
      }
      if (secret) {
        const stored = await this.account.setSecret({
          version: 1,
          requestId,
          credentialRef,
          secret,
          accountId: requestedAccount,
          remember,
        });
        if (!stored.ok) {
          if (this.isCurrent(generation, requestedAccount)) this.error.set(stored.error.message);
          return false;
        }
        this.profiles.update((items) =>
          items.map((item) =>
            item.accountId === requestedAccount
              ? { ...item, hasPersistentCredential: remember }
              : item,
          ),
        );
      }
      const endpoint = this.account.getConfig()?.endpoint;
      if (!profile && (!endpoint?.host || !endpoint.port))
        throw new Error('XMPP endpoint is not configured');
      if (profile && options?.autoLoginExplicit) {
        const preference = await this.preferencesPort.update({
          accountId: requestedAccount,
          changes: { autoLogin: Boolean(options?.autoLogin && remember) },
        });
        if (preference.ok)
          this.preferences.update((current) => ({ ...current, ...preference.value }));
      }
      const result = await this.xmpp.connect({
        version: 1,
        requestId,
        accountId: requestedAccount,
        ...(endpoint ? { endpoint } : {}),
        ...(options?.profile || profile
          ? { profileId: (options?.profile || profile)?.accountId }
          : {}),
        ...(options?.domain ? { profileDomain: options.domain } : {}),
        credentialRef,
      });
      if (!result.ok) {
        if (this.isCurrent(generation, requestedAccount)) this.error.set(result.error.message);
        return false;
      }
      if (!this.isCurrent(generation, requestedAccount)) return false;
      this.connection.set(result.value);
      this.contacts.update((items) =>
        items.map((contact) => ({
          ...contact,
          presence: {
            jid: contact.jid,
            availability: 'unknown' as const,
            updatedAt: new Date().toISOString(),
          },
        })),
      );
      const roster = await this.xmpp.listRoster(requestedAccount);
      if (roster.ok && this.isCurrent(generation, requestedAccount)) this.mergeRoster(roster.value);
      if (this.isCurrent(generation, requestedAccount)) {
        await this.loadPreferences(generation, requestedAccount);
      }
      return true;
    } catch {
      if (this.isCurrent(generation, requestedAccount)) {
        this.error.set('No fue posible iniciar sesión con el servidor XMPP.');
      }
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.certificateRequest.set(null);
    const result = await this.xmpp.disconnect(this.accountId());
    if (result.ok) {
      this.connection.set({
        ...this.connection(),
        status: 'idle',
        since: new Date().toISOString(),
      });
      this.clearChatStates();
    }
  }

  async refreshState(): Promise<void> {
    const result = await this.xmpp.getState(this.accountId());
    if (result.ok) this.connection.set(result.value);
    else this.error.set(result.error.message);
  }

  async refreshRoster(): Promise<void> {
    const accountId = this.accountId();
    const generation = this.identityGeneration;
    const result = await this.xmpp.listRoster(accountId);
    if (result.ok && this.isCurrent(generation, accountId)) {
      this.mergeRoster(result.value);
      await this.loadStoredConversations(accountId, generation);
    } else if (!result.ok && this.isCurrent(generation, accountId)) {
      this.error.set(result.error.message);
    }
  }

  async loadConversation(conversationId: string): Promise<void> {
    if (!this.isAvailable() || !conversationId) return;
    const accountId = this.accountId();
    const generation = this.identityGeneration;
    const requestId = createOpaqueId('history');
    const context: HistoryContext = {
      accountId,
      conversationId: this.bareConversation(conversationId),
      generation,
      requestId,
    };
    this.historyContext = context;
    this.historyLoading.set(true);
    this.olderCursor = null;
    this.newerCursor = null;
    this.historyPages = [];
    this.messages.set([]);
    try {
      const result = await this.history.listPage({
        version: 1,
        requestId,
        accountId,
        conversationId: context.conversationId,
        limit: 50,
        direction: 'older',
        cursor: null,
      });
      if (!this.isHistoryContextCurrent(context)) return;
      if (result.ok) {
        if (result.value.nextCursor) this.historyPages = [{ cursor: result.value.nextCursor }];
        this.olderCursor = result.value.nextCursor;
        this.hasOlderMessages.set(result.value.hasMore);
        this.hasNewerMessages.set(false);
        this.messages.set(result.value.items.slice(-200));
        this.unread.markRead(accountId, 'direct', context.conversationId);
      } else this.error.set(result.error.message);
    } finally {
      if (this.isHistoryContextCurrent(context)) this.historyLoading.set(false);
    }
  }

  async loadOlderMessages(conversationId: string): Promise<void> {
    await this.loadHistoryPage(conversationId, 'older');
  }

  async loadNewerMessages(conversationId: string): Promise<void> {
    await this.loadHistoryPage(conversationId, 'newer');
  }

  async loadPreferences(
    generation = this.identityGeneration,
    accountId = this.accountId(),
  ): Promise<void> {
    if (!this.isAvailable()) return;
    await this.loadStoredConversations(accountId, generation);
    const result = await this.preferencesPort.get({ accountId });
    if (!this.isCurrent(generation, accountId)) return;
    if (result.ok) this.preferences.set(result.value);
    else this.error.set(result.error.message);
  }

  async updatePreferences(changes: Partial<Preferences>): Promise<void> {
    if (!this.isAvailable()) return;
    const result = await this.preferencesPort.update({ accountId: this.accountId(), changes });
    if (result.ok) this.preferences.update((current) => ({ ...current, ...result.value }));
    else this.error.set(result.error.message);
  }

  async resetPreferences(): Promise<void> {
    if (!this.isAvailable()) return;
    const result = await this.preferencesPort.reset({ accountId: this.accountId() });
    if (result.ok) this.preferences.set(result.value);
    else this.error.set(result.error.message);
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
    const cleanText = text.trim();
    const recipient = conversationId.trim();
    if (!cleanText || !recipient || !this.accountId().trim()) return false;
    try {
      const result = await this.xmpp.sendMessage({
        version: 1,
        requestId: createOpaqueId('req'),
        accountId: this.accountId(),
        conversationId: recipient,
        clientMessageId: createOpaqueId('client-msg'),
        body: { kind: 'text', text: cleanText },
      });
      if (result.ok) {
        await this.sendChatState(conversationId, 'active');
        this.upsertMessage(result.value, recipient);
        return true;
      }
      this.error.set(result.error.message);
      return false;
    } catch {
      this.error.set('No fue posible enviar el mensaje.');
      return false;
    }
  }

  async updateTypingState(conversationId: string, draft: string): Promise<void> {
    const state: ChatState = draft.trim() ? 'composing' : 'active';
    await this.sendChatState(conversationId, state);
    const key = this.bareConversation(conversationId);
    const previous = this.typingTimers.get(key);
    if (previous) clearTimeout(previous);
    if (state === 'composing') {
      this.typingTimers.set(
        key,
        setTimeout(() => {
          void this.sendChatState(conversationId, 'paused');
          this.typingTimers.delete(key);
        }, 1200),
      );
    }
  }

  async setTypingActivity(conversationId: string, state: Extract<ChatState, 'active' | 'inactive'>): Promise<void> {
    const timer = this.typingTimers.get(this.bareConversation(conversationId));
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(this.bareConversation(conversationId));
    }
    await this.sendChatState(conversationId, state);
  }

  markConversationRead(conversationId: string): void {
    this.unread.markRead(this.accountId(), 'direct', conversationId);
    this.clearAttentionIfRead(this.accountId());
  }

  private async loadStoredConversations(accountId: string, generation: number): Promise<void> {
    try {
      const result = await this.history.conversations({
        version: 1,
        requestId: createOpaqueId('req'),
        accountId,
      });
      if (!this.isCurrent(generation, accountId) || !result.ok) return;
      this.conversationSummaries.set(
        result.value.map((conversation) => ({
          id: `${accountId}|direct|${conversation.jid}`,
          accountId,
          kind: 'direct' as const,
          jid: this.bareConversation(conversation.jid),
          title: this.contactTitle(conversation.jid),
          unreadCount: this.unreadCount(accountId, 'direct', conversation.jid),
          lastMessageAt: Date.parse(conversation.lastActivity) || undefined,
        })),
      );
      for (const conversation of result.value)
        this.addConversation(accountId, conversation.jid, Date.parse(conversation.lastActivity));
    } catch {
      // History recovery is best effort; it must not turn a valid login into a failure.
    }
  }

  private async loadHistoryPage(
    conversationId: string,
    direction: 'older' | 'newer',
  ): Promise<void> {
    if (!this.isAvailable() || !conversationId || this.historyLoading()) return;
    const context = this.historyContext;
    const cursor = direction === 'older' ? this.olderCursor : this.newerCursor;
    if (!cursor || !context || context.conversationId !== this.bareConversation(conversationId))
      return;
    const accountId = this.accountId();
    const requestId = createOpaqueId('history');
    this.historyLoading.set(true);
    try {
      const result = await this.history.listPage({
        version: 1,
        requestId,
        accountId,
        conversationId: context.conversationId,
        limit: 50,
        direction,
        cursor,
      });
      if (!this.isHistoryContextCurrent(context)) return;
      if (!result.ok) {
        this.error.set(result.error.message);
        return;
      }
      const previous = this.messages();
      const merged = [...previous, ...result.value.items]
        .filter(
          (item, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.id === item.id || candidate.clientMessageId === item.clientMessageId,
            ) === index,
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const progressed = merged.length > previous.length;
      if (!progressed || !result.value.nextCursor) {
        if (direction === 'older') this.hasOlderMessages.set(false);
        else this.hasNewerMessages.set(false);
        return;
      }
      const page = { cursor: result.value.nextCursor };
      if (direction === 'older') {
        this.historyPages.unshift(page);
        if (this.historyPages.length > 4) this.historyPages.pop();
        this.olderCursor = this.historyPages[0]?.cursor || null;
        this.newerCursor =
          this.historyPages.length === 4
            ? this.historyPages[this.historyPages.length - 1]?.cursor || null
            : null;
        this.hasOlderMessages.set(result.value.hasMore);
        this.hasNewerMessages.set(this.historyPages.length === 4);
        this.messages.set(merged.slice(0, 200));
      } else {
        this.historyPages.push(page);
        if (this.historyPages.length > 4) this.historyPages.shift();
        this.olderCursor =
          this.historyPages.length === 4 ? this.historyPages[0]?.cursor || null : this.olderCursor;
        this.newerCursor = this.historyPages[this.historyPages.length - 1]?.cursor || null;
        this.hasNewerMessages.set(result.value.hasMore);
        this.hasOlderMessages.set(this.historyPages.length === 4 || this.hasOlderMessages());
        this.messages.set(merged.slice(-200));
      }
    } finally {
      if (this.isHistoryContextCurrent(context)) this.historyLoading.set(false);
    }
  }

  private isCurrent(generation: number, accountId: string): boolean {
    return generation === this.identityGeneration && accountId === this.accountId();
  }

  private isAvailable(): boolean {
    return this.account.isAvailable?.() ?? Boolean(this.account.getConfig());
  }

  private isHistoryContextCurrent(context: HistoryContext): boolean {
    return (
      this.isCurrent(context.generation, context.accountId) &&
      this.historyContext?.requestId === context.requestId &&
      this.historyContext.conversationId === context.conversationId
    );
  }

  private upsertMessage(message: Message, conversationId?: string): void {
    const activeConversation = this.historyContext?.conversationId;
    if (
      activeConversation &&
      this.bareConversation(message.conversationId) !== activeConversation
    ) {
      if (conversationId) this.addConversation(message.accountId, conversationId);
      return;
    }
    this.messages.update((items) => {
      const next = items.filter(
        (item) => item.clientMessageId !== message.clientMessageId && item.id !== message.id,
      );
      let low = 0;
      let high = next.length;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (next[middle].createdAt.localeCompare(message.createdAt) <= 0) low = middle + 1;
        else high = middle;
      }
      next.splice(low, 0, message);
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
    if (conversationId) this.addConversation(message.accountId, conversationId, Date.parse(message.createdAt));
  }

  private addConversation(accountId: string, jid: string, activity = Date.now()): void {
    if (accountId !== this.accountId() || !jid) return;
    const safeActivity = Number.isFinite(activity) ? activity : Date.now();
    const bare = jid.split('/')[0].toLowerCase();
    this.contacts.update((items) =>
      items.some((item) => item.jid.split('/')[0].toLowerCase() === bare)
        ? items
        : [...items, { jid: bare, name: bare, groups: [], source: 'conversation' }],
    );
    this.conversationSummaries.update((items) => {
      const existing = items.find(
        (item) => item.accountId === accountId && item.kind === 'direct' && item.jid === bare,
      );
      const next: ConversationSummary = {
        id: `${accountId}|direct|${bare}`,
        accountId,
        kind: 'direct',
        jid: bare,
        title: this.contactTitle(bare),
        unreadCount: this.unreadCount(accountId, 'direct', bare),
        lastMessageAt: Math.max(existing?.lastMessageAt || 0, safeActivity),
      };
      return existing
        ? items.map((item) => (item.id === existing.id ? next : item))
        : [...items, next];
    });
  }

  private mergeRoster(roster: Contact[]): void {
    const accountId = this.accountId();
    if (this.contactsOwner !== accountId) {
      this.contacts.set([]);
      this.contactsOwner = accountId;
    }
    const previous = new Map(
      this.contacts().map((contact) => [contact.jid.split('/')[0].toLowerCase(), contact]),
    );
    const normalized = new Map<string, Contact>();
    for (const contact of roster) {
      const jid = contact.jid.split('/')[0].toLowerCase();
      const authorized = contact.subscription === 'to' || contact.subscription === 'both';
      const old = previous.get(jid);
      normalized.set(jid, {
        ...contact,
        jid,
        source: 'roster',
        presence:
          authorized && old?.presence
            ? old.presence
            : {
                jid,
                availability: 'unknown',
                updatedAt: new Date().toISOString(),
              },
      });
    }
    this.contacts.update((items) => {
      const local = items.filter(
        (item) =>
          item.source === 'conversation' && !normalized.has(item.jid.split('/')[0].toLowerCase()),
      );
      return [...normalized.values(), ...local];
    });
  }

  private bareConversation(conversationId: string): string {
    return conversationId.split('/')[0].toLowerCase();
  }

  private contactTitle(jid: string): string {
    const bare = this.bareConversation(jid);
    return this.contacts().find((contact) => this.bareConversation(contact.jid) === bare)?.name?.trim() || bare;
  }

  private unreadCount(accountId: string, kind: 'direct' | 'muc', jid: string): number {
    return this.unread.counts().get(`${accountId.toLowerCase()}|${kind}|${this.bareConversation(jid)}`) || 0;
  }

  private isOwnMessage(message: Message): boolean {
    return this.bareConversation(message.senderJid) === this.bareConversation(message.accountId);
  }

  private async sendChatState(conversationId: string, state: ChatState): Promise<void> {
    const send = this.xmpp.sendChatState;
    if (!send || !this.isConnected() || !conversationId.trim()) return;
    const key = this.bareConversation(conversationId);
    if (this.outgoingChatStates.get(key) === state) return;
    this.outgoingChatStates.set(key, state);
    const input: ChatStateInput = {
      version: 1,
      requestId: createOpaqueId('chat-state'),
      accountId: this.accountId(),
      conversationId: conversationId.trim(),
      state,
    };
    try {
      await send.call(this.xmpp, input);
    } catch {
      if (this.outgoingChatStates.get(key) === state) this.outgoingChatStates.delete(key);
      // Typing notifications are best effort and must never block chat messages.
    }
  }

  private receiveChatState(event: { accountId: string; conversationId: string; senderJid: string; state: ChatState }): void {
    if (event.accountId !== this.accountId() || this.isOwnJid(event.senderJid)) return;
    const key = this.bareConversation(event.conversationId);
    const previous = this.typingTimers.get(`incoming:${key}`);
    if (previous) clearTimeout(previous);
    if (event.state === 'composing') {
      this.typingStates.set(key, event.state);
      this.typingTimers.set(
        `incoming:${key}`,
        setTimeout(() => {
          this.typingStates.delete(key);
          this.publishChatStates();
        }, 6000),
      );
    } else {
      this.typingStates.delete(key);
      this.typingTimers.delete(`incoming:${key}`);
    }
    this.publishChatStates();
  }

  private isOwnJid(jid: string): boolean {
    return this.bareConversation(jid) === this.bareConversation(this.accountId());
  }

  private publishChatStates(): void {
    this.chatStates.set(new Map(this.typingStates));
  }

  private clearChatStates(): void {
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    this.outgoingChatStates.clear();
    this.typingStates.clear();
    this.publishChatStates();
  }

  private async requestAttention(accountId: string, conversationId: string): Promise<void> {
    if (!this.attention) return;
    const input: AttentionRequest = {
      version: 1,
      requestId: createOpaqueId('attention'),
      accountId,
      conversationId: this.bareConversation(conversationId),
    };
    try {
      await this.attention.request(input);
    } catch {
      // Native attention is best effort and never blocks message handling.
    }
  }

  private clearAttentionIfRead(accountId: string): void {
    if (!this.attention || this.unread.totalForAccount(accountId) !== 0) return;
    const input: AttentionClearRequest = {
      version: 1,
      requestId: createOpaqueId('attention-clear'),
      accountId,
    };
    void this.attention.clear(input).catch(() => undefined);
  }
}
