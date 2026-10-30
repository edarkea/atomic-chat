import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { ChatFacade } from './core/chat.facade';
import { MucFacade } from './core/muc.facade';
import { FileFacade } from './core/file.facade';
import {
  CertificateTrustDecision,
  BroadcastMode,
  BroadcastRecipientResult,
  Contact,
  Message,
  Preferences,
  RoomState,
  XmppTransport,
} from './core/domain';
import { BroadcastFacade, bareBroadcastJid } from './core/broadcast.facade';
import { createOpaqueId } from './core/ids';
import { CertificateDialogComponent } from './certificate-dialog.component';
import {
  ConversationTimelineItem,
  ConversationViewComponent,
  OlderMessagesRequest,
} from './conversation-view.component';
import { WorkspaceConversationItem } from './conversation-list.component';
import { LoginPanelComponent } from './login-panel.component';
import {
  ConnectionSettingsDialogComponent,
  ConnectionSettingsDraft,
} from './connection-settings-dialog.component';
import { MucViewComponent } from './muc-view.component';
import { SidebarComponent, SidebarModel } from './sidebar.component';
import { PresenceOption } from './sidebar.models';
import { ActiveConversationStore } from './core/active-conversation.store';
import { WindowFocusStore } from './core/window-focus.store';
import { ConversationVisibilityStore } from './core/conversation-visibility.store';
import { ThemeService } from './core/theme.service';
import { NewMessageDialogComponent, NewMessageDialogModel } from './new-message-dialog.component';
import {
  PreferencesDialogComponent,
  PreferencesDialogModel,
  PreferencesSaveState,
} from './preferences-dialog.component';
import { BroadcastDialogComponent, BroadcastDialogModel } from './broadcast-dialog.component';

type ConversationSelection =
  | { kind: 'none'; accountId: string }
  | { kind: 'direct'; accountId: string; jid: string }
  | { kind: 'muc'; accountId: string; roomJid: string };

@Component({
  selector: 'app-root',
  imports: [
    CertificateDialogComponent,
    ConnectionSettingsDialogComponent,
    ConversationViewComponent,
    LoginPanelComponent,
    MucViewComponent,
    NewMessageDialogComponent,
    PreferencesDialogComponent,
    BroadcastDialogComponent,
    SidebarComponent,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly chat = inject(ChatFacade);
  protected readonly muc = inject(MucFacade);
  private readonly activeConversation = inject(ActiveConversationStore);
  private readonly conversationVisibility = inject(ConversationVisibilityStore);
  private readonly windowFocus = inject(WindowFocusStore);
  protected readonly files = inject(FileFacade);
  protected readonly theme = inject(ThemeService);
  private readonly broadcast = inject(BroadcastFacade);
  protected readonly fileActionPending = (transferId: string): boolean =>
    this.files.isLocalActionPending(transferId);
  protected readonly draft = signal('');
  protected readonly login = signal({
    accountId: '',
    domain: '',
    password: '',
    host: '',
    port: 5222,
    transport: 'starttls' as XmppTransport,
    automatic: true,
    remember: false,
    autoLogin: false,
    autoLoginExplicit: false,
  });
  protected readonly loginBusy = signal(false);
  protected readonly profileActionBusy = signal(false);
  protected readonly selectedProfileId = signal('');
  protected readonly loginProfiles = computed(() => this.chat.profiles?.() ?? []);
  protected readonly search = signal('');
  protected readonly newMessageOpen = signal(false);
  protected readonly newMessageSearch = signal('');
  protected readonly newMessageJoiningRoom = signal<string | null>(null);
  protected readonly newMessageLocalError = signal<string | null>(null);
  protected readonly preferencesOpen = signal(false);
  protected readonly broadcastOpen = signal(false);
  protected readonly broadcastBody = signal('');
  protected readonly broadcastMode = signal<BroadcastMode>('normal');
  protected readonly broadcastHideOffline = signal(false);
  protected readonly broadcastSelectedJids = signal<ReadonlySet<string>>(new Set<string>());
  protected readonly broadcastBusy = signal(false);
  protected readonly broadcastError = signal<string | null>(null);
  protected readonly broadcastResult = signal<ReadonlyArray<BroadcastRecipientResult> | null>(null);
  private broadcastRun = 0;
  protected readonly preferencesSaveState = signal<PreferencesSaveState>('idle');
  protected readonly preferencesError = signal<string | null>(null);
  protected readonly downloadDirectorySelecting = signal(false);
  protected readonly totalUnread = computed(() => this.chat.unreadTotal?.() ?? 0);
  protected readonly conversationError = computed(() => this.files.error() || this.chat.error());
  protected readonly conversationSelection = signal<ConversationSelection>({
    kind: 'none',
    accountId: '',
  });
  protected readonly selectedContact = signal<Contact | undefined>(undefined);
  protected readonly settingsOpen = signal(false);
  protected readonly settingsSaving = signal(false);
  protected readonly settingsError = signal<string | null>(null);
  protected readonly settingsDraft = computed<ConnectionSettingsDraft>(() => {
    const value = this.login();
    return {
      automatic: value.automatic,
      host: value.host,
      port: value.port,
      transport: value.transport,
    };
  });
  protected readonly certificateRequest = computed(() => this.chat.certificateRequest?.() ?? null);
  protected readonly presenceOpen = signal(false);
  protected readonly presenceStatus = signal('');
  protected readonly mucNickname = signal('');
  protected readonly mucDraft = signal('');
  protected readonly mucDiscovering = signal(false);
  protected readonly newMessageContacts = computed(() => {
    const term = this.newMessageSearch().trim().toLowerCase();
    return this.chat
      .contacts()
      .filter(
        (contact) =>
          !term ||
          contact.jid.toLowerCase().includes(term) ||
          contact.name?.toLowerCase().includes(term),
      );
  });
  protected readonly newMessageServices = computed(() => {
    const term = this.newMessageSearch().trim().toLowerCase();
    return this.muc
      .services()
      .filter(
        (room) =>
          !term ||
          room.jid.toLowerCase().includes(term) ||
          room.room.toLowerCase().includes(term) ||
          room.service.toLowerCase().includes(term),
      );
  });
  protected readonly newMessageDialogModel = computed<NewMessageDialogModel>(() => ({
    search: this.newMessageSearch(),
    contacts: this.newMessageContacts(),
    joinedRooms: this.joinedRooms(),
    services: this.newMessageServices(),
    nickname: this.mucNickname(),
    discovering: this.mucDiscovering(),
    joiningRoomJid: this.newMessageJoiningRoom(),
    error: this.newMessageLocalError() || this.muc.error(),
  }));
  protected readonly preferencesDialogModel = computed<PreferencesDialogModel>(() => ({
    preferences: this.chat.preferences(),
    downloadDirectorySelecting: this.downloadDirectorySelecting(),
    saveState: this.preferencesSaveState(),
    error: this.preferencesError(),
  }));
  protected readonly broadcastContacts = computed<ReadonlyArray<Contact>>(() => {
    const accountJid = bareBroadcastJid(this.chat.accountId());
    const contactsByJid = new Map<string, Contact>();
    for (const contact of this.chat.contacts()) {
      const jid = bareBroadcastJid(contact.jid);
      if (!jid || jid === accountJid || contact.source === 'conversation') continue;
      const previous = contactsByJid.get(jid);
      if (!previous) {
        contactsByJid.set(jid, { ...contact, jid, groups: [...contact.groups] });
        continue;
      }
      contactsByJid.set(jid, {
        ...previous,
        name: previous.name || contact.name,
        groups: [...new Set([...previous.groups, ...contact.groups])],
        presence: previous.presence || contact.presence,
      });
    }
    const contacts = [...contactsByJid.values()];
    return contacts.sort((left, right) =>
      (left.name || left.jid).localeCompare(right.name || right.jid),
    );
  });
  protected readonly broadcastGroups = computed<ReadonlyArray<string>>(() =>
    [...new Set(this.broadcastContacts().flatMap((contact) => contact.groups.map((group) => group.trim()).filter(Boolean)))].sort(
      (left, right) => left.localeCompare(right),
    ),
  );
  protected readonly broadcastDialogModel = computed<BroadcastDialogModel>(() => ({
    contacts: this.broadcastContacts(),
    groups: this.broadcastGroups(),
    selectedJids: this.broadcastSelectedJids(),
    body: this.broadcastBody(),
    mode: this.broadcastMode(),
    hideOffline: this.broadcastHideOffline(),
    busy: this.broadcastBusy(),
    error: this.broadcastError(),
    result: this.broadcastResult(),
  }));
  protected readonly activeSelection = computed<ConversationSelection>(() => {
    const selection = this.conversationSelection();
    const accountId = this.chat.accountId();
    if (!accountId || !this.chat.isConnected() || selection.accountId !== accountId)
      return { kind: 'none', accountId };
    if (selection.kind === 'muc' && !this.joinedRoom(selection.roomJid))
      return { kind: 'none', accountId };
    return selection;
  });
  protected readonly selectedJid = computed(() => {
    const selection = this.activeSelection();
    return selection.kind === 'direct' ? selection.jid : '';
  });
  protected readonly joinedRooms = computed(() => {
    const activity = this.muc.roomActivity?.() ?? new Map<string, number>();
    return this.muc
      .states()
      .filter((state) => state.accountId === this.chat.accountId() && state.status === 'joined')
      .slice()
      .sort(
        (left, right) =>
          (activity.get(right.room.jid.toLowerCase()) || 0) -
            (activity.get(left.room.jid.toLowerCase()) || 0) ||
          left.room.jid.localeCompare(right.room.jid),
      );
  });
  protected readonly workspaceContacts = computed(() => {
    const term = this.search().trim().toLowerCase();
    const summariesSignal = this.chat.conversationSummaries;
    if (!summariesSignal) return undefined;
    const summaries = summariesSignal();
    return summaries
      .slice()
      .sort(
        (left, right) =>
          (right.lastMessageAt || 0) - (left.lastMessageAt || 0) ||
          left.jid.localeCompare(right.jid),
      )
      .filter(
        (summary) =>
          !term || summary.jid.includes(term) || summary.title.toLowerCase().includes(term),
      )
      .filter(
        (summary) =>
          !this.conversationVisibility.isHidden(summary.accountId, 'direct', summary.jid),
      )
      .map(
        (summary) =>
          this.chat
            .contacts()
            .find((contact) => this.bareJid(contact.jid) === this.bareJid(summary.jid)) ||
          ({
            jid: summary.jid,
            name: summary.title,
            groups: [],
            source: 'conversation',
          } satisfies Contact),
      );
  });
  protected readonly workspaceItems = computed<
    ReadonlyArray<WorkspaceConversationItem> | undefined
  >(() => {
    const summariesSignal = this.chat.conversationSummaries;
    if (!summariesSignal) return undefined;
    const term = this.search().trim().toLowerCase();
    const activity = this.muc.roomActivity?.() ?? new Map<string, number>();
    const directItems: WorkspaceConversationItem[] = summariesSignal()
      .filter(
        (summary) =>
          !this.conversationVisibility.isHidden(summary.accountId, 'direct', summary.jid) &&
          (!term || summary.jid.includes(term) || summary.title.toLowerCase().includes(term)),
      )
      .map((summary) => ({
        kind: 'direct' as const,
        contact:
          this.chat
            .contacts()
            .find((contact) => this.bareJid(contact.jid) === this.bareJid(summary.jid)) ||
          ({
            jid: summary.jid,
            name: summary.title,
            groups: [],
            source: 'conversation',
          } satisfies Contact),
        lastActivity: summary.lastMessageAt || 0,
      }));
    const roomItems: WorkspaceConversationItem[] = this.joinedRooms()
      .filter(
        (state) =>
          !this.conversationVisibility.isHidden(state.accountId, 'muc', state.room.jid) &&
          (!term ||
            state.room.jid.toLowerCase().includes(term) ||
            state.room.room.toLowerCase().includes(term) ||
            state.room.service.toLowerCase().includes(term)),
      )
      .map((roomState) => ({
        kind: 'muc' as const,
        roomState,
        lastActivity: activity.get(roomState.room.jid.toLowerCase()) || 0,
      }));
    return [...directItems, ...roomItems].sort(
      (left, right) =>
        right.lastActivity - left.lastActivity ||
        `${left.kind}:${left.kind === 'muc' ? left.roomState.room.jid : left.contact.jid}`.localeCompare(
          `${right.kind}:${right.kind === 'muc' ? right.roomState.room.jid : right.contact.jid}`,
        ),
    );
  });
  protected readonly activeRoomState = computed(() => {
    const selection = this.activeSelection();
    return selection.kind === 'muc' ? this.joinedRoom(selection.roomJid) : undefined;
  });
  protected readonly filteredContacts = computed(() => {
    const term = this.search().trim().toLowerCase();
    const accountId = this.chat.accountId();
    return this.chat
      .contacts()
      .filter(
        (contact) =>
          !this.conversationVisibility.isHidden(accountId, 'direct', contact.jid) &&
          (!term ||
            contact.jid.toLowerCase().includes(term) ||
            contact.name?.toLowerCase().includes(term)),
      );
  });
  protected readonly visibleMessages = computed(() => {
    const jid = this.bareJid(this.selectedJid());
    if (!jid) return [];
    const accountId = this.chat.accountId();
    return this.chat
      .messages()
      .filter(
        (message) =>
          message.accountId === accountId &&
          (this.bareJid(message.conversationId) === jid || this.bareJid(message.senderJid) === jid),
      );
  });
  protected readonly typingContact = computed(() => {
    const jid = this.bareJid(this.selectedJid());
    return Boolean(jid && this.chat.chatStates?.().get(jid) === 'composing');
  });
  protected readonly conversationTimeline = computed<ReadonlyArray<ConversationTimelineItem>>(
    () => {
      const messages: ConversationTimelineItem[] = this.visibleMessages().map((message) => ({
        kind: 'text',
        id: `text:${message.clientMessageId || message.id}`,
        sortAt: message.createdAt,
        message,
        senderLabel: this.directSenderLabel(message),
        outgoing: this.isOutgoing(message),
      }));
      const files: ConversationTimelineItem[] = this.files
        .forConversation(this.chat.accountId(), this.selectedJid())
        .map((transfer) => ({
          kind: 'file',
          id: `file:${transfer.offer.transferId}`,
          sortAt: transfer.offer.offeredAt,
          transfer,
          senderLabel: transfer.direction === 'outgoing' ? 'Tú' : transfer.offer.senderJid,
          outgoing: transfer.direction === 'outgoing',
          label: this.files.label(transfer.state, transfer.endReason, transfer.direction),
          progressLabel: this.files.label(transfer.state, transfer.endReason, transfer.direction),
        }));
      return [...messages, ...files].sort(
        (left, right) => left.sortAt.localeCompare(right.sortAt) || left.id.localeCompare(right.id),
      );
    },
  );
  protected readonly activeContact = computed(() => {
    const jid = this.bareJid(this.selectedJid());
    return this.chat.contacts().find((contact) => this.bareJid(contact.jid) === jid);
  });
  protected readonly presenceOptions: ReadonlyArray<PresenceOption> = [
    { id: 'chat', mode: 'chat', label: 'Libre para chatear', dot: 'chat' },
    { id: 'online', mode: undefined, label: 'En línea', dot: 'online' },
    { id: 'away', mode: 'away', label: 'Ausente', dot: 'away' },
    { id: 'phone', mode: 'away', label: 'Al teléfono', dot: 'phone' },
    { id: 'xa', mode: 'xa', label: 'Ausencia extendida', dot: 'xa' },
    { id: 'dnd', mode: 'dnd', label: 'No molestar', dot: 'dnd' },
  ];
  protected readonly sidebarModel = computed<SidebarModel>(() => ({
    operator: {
      accountId: this.chat.accountId(),
      connectionLabel: this.connectionLabel(),
      presenceLabel: this.presenceLabel(),
      presenceDot: this.presenceDot(),
      presenceOpen: this.presenceOpen(),
      presenceOptions: this.presenceOptions,
      presenceOptionId: this.selectedPresenceOption().id,
      presenceStatus: this.presenceStatus(),
    },
    muc: {
      nickname: this.mucNickname(),
      discovering: this.mucDiscovering(),
      error: this.muc.error(),
      services: this.muc.services().filter((room) => {
        const term = this.search().trim().toLowerCase();
        return (
          !term ||
          room.jid.toLowerCase().includes(term) ||
          room.room.toLowerCase().includes(term) ||
          room.service.toLowerCase().includes(term)
        );
      }),
      states: this.muc.states(),
      selectedRoomJid: this.muc.selectedRoomJid(),
      activeRoomState: this.activeRoomState(),
    },
    conversations: {
      search: this.search(),
      accountId: this.chat.accountId(),
      joinedRooms: this.joinedRooms(),
      filteredContacts: this.filteredContacts(),
      workspaceContacts: this.workspaceContacts(),
      workspaceItems: this.workspaceItems(),
      muc: {
        nickname: this.mucNickname(),
        discovering: this.mucDiscovering(),
        error: this.muc.error(),
        services: this.muc.services().filter((room) => {
          const term = this.search().trim().toLowerCase();
          return (
            !term ||
            room.jid.toLowerCase().includes(term) ||
            room.room.toLowerCase().includes(term) ||
            room.service.toLowerCase().includes(term)
          );
        }),
        states: this.muc.states(),
        selectedRoomJid: this.muc.selectedRoomJid(),
        activeRoomState: this.activeRoomState(),
      },
      unreadCounts: this.chat.unreadCounts?.() ?? new Map(),
      selectedJid: this.selectedJid(),
      selectedRoomJid: this.muc.selectedRoomJid(),
    },
  }));
  @ViewChild(LoginPanelComponent) private loginPanel?: LoginPanelComponent;
  @ViewChild(ConversationViewComponent) private conversationView?: ConversationViewComponent;
  @ViewChild(SidebarComponent) private sidebar?: SidebarComponent;

  constructor() {
    void this.chat.tryAutoLogin();
    effect(() => {
      const selection = this.activeSelection();
      this.activeConversation.set(
        selection.kind === 'none'
          ? null
          : {
              accountId: selection.accountId,
              kind: selection.kind,
              jid: selection.kind === 'direct' ? selection.jid : selection.roomJid,
            },
      );
    });
    effect(() => {
      if (!this.windowFocus.isFocused()) return;
      const selection = this.activeConversation.current();
      if (!selection) return;
      if (selection.kind === 'direct') this.chat.markConversationRead(selection.jid);
      else this.muc.markConversationRead(selection.jid);
    });
    effect(() => {
      const account = this.chat.accountId();
      if (this.chat.isConnected() && account) void this.files.setAccount(account);
    });
    effect(() => {
      this.conversationVisibility.setAccount(this.chat.accountId());
    });
    effect(() => {
      if (this.chat.preferencesLoaded?.() && !this.chat.preferences().hideClosedConversations)
        this.conversationVisibility.clearAll();
    });
  }

  protected setLoginAccount(accountId: string): void {
    if (accountId !== this.login().accountId && this.selectedProfileId()) {
      this.selectedProfileId.set('');
      this.login.update((value) => ({
        ...value,
        accountId,
        password: '',
        remember: false,
        autoLogin: false,
        autoLoginExplicit: false,
      }));
      return;
    }
    this.login.update((value) => ({ ...value, accountId }));
  }
  protected setLoginDomain(domain: string): void {
    const selected = this.loginProfiles().find(
      (profile) => profile.accountId === this.selectedProfileId(),
    );
    if (selected?.accountId.includes('@') && domain !== this.login().domain) {
      this.selectedProfileId.set('');
      this.login.update((value) => ({
        ...value,
        password: '',
        remember: false,
        autoLogin: false,
        autoLoginExplicit: false,
      }));
    }
    this.login.update((value) => ({ ...value, domain }));
  }
  protected setLoginPassword(password: string): void {
    this.login.update((value) => ({ ...value, password }));
  }
  protected setLoginHost(host: string): void {
    this.login.update((value) => ({ ...value, host }));
  }
  protected setLoginPort(port: number): void {
    this.login.update((value) => ({ ...value, port }));
  }
  protected setLoginTransport(transport: XmppTransport): void {
    this.login.update((value) => ({
      ...value,
      transport,
      port:
        value.port === (transport === 'direct-tls' ? 5222 : 5223)
          ? transport === 'direct-tls'
            ? 5223
            : 5222
          : value.port,
    }));
  }
  protected setLoginAutomatic(automatic: boolean): void {
    this.login.update((value) => ({ ...value, automatic }));
  }
  protected setLoginRemember(remember: boolean): void {
    this.login.update((value) => ({
      ...value,
      remember,
      autoLogin: remember ? value.autoLogin : false,
      autoLoginExplicit: true,
    }));
  }
  protected setLoginAutoLogin(autoLogin: boolean): void {
    this.login.update((value) => ({ ...value, autoLogin, autoLoginExplicit: true }));
  }
  protected async selectLoginProfile(accountId: string): Promise<void> {
    this.selectedProfileId.set(accountId);
    const profile = this.loginProfiles().find((item) => item.accountId === accountId);
    if (!profile) {
      this.resetLoginForNewAccount();
      return;
    }
    const at = profile.accountId.lastIndexOf('@');
    this.login.update((value) => ({
      ...value,
      accountId: at > 0 ? profile.accountId.slice(0, at) : profile.accountId,
      domain: profile.domain,
      host: profile.manualEndpoint?.host || '',
      port: profile.manualEndpoint?.port || 5222,
      transport: profile.manualEndpoint?.transport || 'starttls',
      automatic: profile.mode === 'automatic',
      password: '',
      remember: profile.hasPersistentCredential === true,
      autoLogin: false,
      autoLoginExplicit: false,
    }));
    const preferences = await this.chat.getProfilePreferences(profile.accountId);
    if (this.selectedProfileId() !== profile.accountId) return;
    this.login.update((value) => ({
      ...value,
      autoLogin: profile.hasPersistentCredential === true && Boolean(preferences?.autoLogin),
    }));
  }
  protected async forgetLoginSecret(): Promise<void> {
    const accountId = this.selectedProfileId();
    if (!accountId || this.profileActionBusy()) return;
    this.profileActionBusy.set(true);
    try {
      if (await this.chat.forgetSecret(accountId))
        this.login.update((value) => ({ ...value, autoLogin: false, remember: false }));
    } finally {
      this.profileActionBusy.set(false);
    }
  }
  protected async deleteLoginProfile(): Promise<void> {
    const accountId = this.selectedProfileId();
    if (!accountId || this.profileActionBusy()) return;
    this.profileActionBusy.set(true);
    try {
      if (await this.chat.deleteProfile(accountId)) {
        this.selectedProfileId.set('');
        this.resetLoginForNewAccount();
      }
    } finally {
      this.profileActionBusy.set(false);
    }
  }
  private resetLoginForNewAccount(): void {
    this.login.set({
      accountId: '',
      domain: '',
      password: '',
      host: '',
      port: 5222,
      transport: 'starttls',
      automatic: true,
      remember: false,
      autoLogin: false,
      autoLoginExplicit: false,
    });
  }
  protected openAdvancedSettings(): void {
    this.settingsError.set(null);
    this.settingsOpen.set(true);
  }
  protected cancelAdvancedSettings(): void {
    this.settingsError.set(null);
    this.settingsOpen.set(false);
    queueMicrotask(() => this.loginPanel?.focusAdvancedSettings());
  }
  protected async saveAdvancedSettings(settings: ConnectionSettingsDraft): Promise<void> {
    if (!settings.automatic && (!settings.host.trim() || !Number.isInteger(settings.port))) {
      this.settingsError.set('Indica un host y un puerto entero entre 1 y 65535.');
      return;
    }
    if (!settings.automatic && (settings.port < 1 || settings.port > 65535)) {
      this.settingsError.set('El puerto debe estar entre 1 y 65535.');
      return;
    }
    this.settingsSaving.set(true);
    this.settingsError.set(null);
    try {
      const selected = this.loginProfiles().find(
        (profile) => profile.accountId === this.selectedProfileId(),
      );
      if (selected) {
        const domain = selected.accountId.includes('@')
          ? selected.domain
          : this.login().domain.trim();
        if (!domain) {
          this.settingsError.set('Indica el dominio XMPP de la cuenta heredada antes de guardar.');
          return;
        }
        const saved = await this.chat.saveProfile({
          ...selected,
          domain,
          mode: settings.automatic ? 'automatic' : 'manual',
          ...(settings.automatic
            ? { manualEndpoint: undefined }
            : {
                manualEndpoint: {
                  host: settings.host.trim(),
                  port: settings.port,
                  transport: settings.transport,
                },
              }),
          updatedAt: new Date().toISOString(),
        });
        if (!saved?.ok) {
          this.settingsError.set(saved?.error.message || 'No fue posible guardar el perfil.');
          return;
        }
      }
      this.login.update((value) => ({
        ...value,
        automatic: settings.automatic,
        host: settings.host.trim(),
        port: settings.port,
        transport: settings.transport,
      }));
      this.cancelAdvancedSettings();
    } finally {
      this.settingsSaving.set(false);
    }
  }
  protected connectionLabel(): string {
    const labels: Record<string, string> = {
      idle: 'Desconectado',
      connecting: 'Conectando',
      authenticating: 'Autenticando',
      connected: 'Conectado',
      disconnecting: 'Desconectando',
      failed: 'Falló',
    };
    return labels[this.chat.connection().status] || this.chat.connection().status;
  }
  protected presenceLabel(): string {
    return this.selectedPresenceOption().label;
  }
  protected presenceDot(): string {
    return this.selectedPresenceOption().dot;
  }
  protected async choosePresence(option: PresenceOption): Promise<void> {
    const status =
      option.id === 'phone' ? 'Al teléfono' : option.id === 'away' ? '' : this.presenceStatus();
    await this.chat.setPresence(option.mode, status);
    this.presenceOpen.set(false);
  }
  protected async connect(): Promise<void> {
    const login = this.login() as typeof this.login extends () => infer Value
      ? Value &
          Partial<{
            domain: string;
            host: string;
            port: number;
            transport: XmppTransport;
            automatic: boolean;
            remember: boolean;
            autoLogin: boolean;
          }>
      : never;
    const rawUser = login.accountId.trim();
    const suppliedDomain = (login.domain || '').trim().toLowerCase().replace(/\.$/, '');
    const at = rawUser.indexOf('@');
    if (
      at >= 0 &&
      (at !== rawUser.lastIndexOf('@') || !rawUser.slice(0, at) || !rawUser.slice(at + 1))
    ) {
      this.chat.error.set('Introduce un usuario XMPP o un JID completo válido.');
      return;
    }
    const localpart = at >= 0 ? rawUser.slice(0, at) : rawUser;
    const domain = at >= 0 ? rawUser.slice(at + 1).toLowerCase() : suppliedDomain;
    if (!localpart || /[\s/@]/.test(localpart) || !domain || /[\s/@]/.test(domain)) {
      this.chat.error.set('El usuario y el dominio XMPP son obligatorios.');
      return;
    }
    const selectedProfile = this.loginProfiles().find(
      (profile) => profile.accountId === this.selectedProfileId(),
    );
    const legacyProfile =
      selectedProfile && !selectedProfile.accountId.includes('@') ? selectedProfile : undefined;
    const accountId = legacyProfile ? legacyProfile.accountId : `${localpart}@${domain}`;
    this.resetConversationSelection();
    this.muc.setAccount(accountId);
    this.loginBusy.set(true);
    const connected = await this.chat.connect(accountId, login.password, {
      ...(legacyProfile ? { profile: legacyProfile } : {}),
      domain,
      mode: login.automatic !== false ? 'automatic' : 'manual',
      manualEndpoint: {
        host: (login.host || '').trim(),
        port: login.port || 5222,
        transport: login.transport || 'starttls',
      },
      remember: login.remember === true,
      autoLogin: login.autoLogin === true,
      autoLoginExplicit: login.autoLoginExplicit === true,
    });
    this.loginBusy.set(false);
    if (connected) {
      this.login.update((value) => ({ ...value, password: '' }));
      await this.files.setAccount(this.chat.accountId());
    }
  }
  protected async disconnect(): Promise<void> {
    this.cancelBroadcastForAccount();
    this.resetConversationSelection();
    await this.chat.disconnect();
    await this.files.setAccount('');
  }
  protected async decideCertificate(decision: CertificateTrustDecision): Promise<void> {
    await this.chat.decideCertificate(decision);
  }
  protected selectContact(contact: Contact): void {
    this.closeNewMessageDialog();
    this.followLatest();
    this.draft.set('');
    this.mucDraft.set('');
    this.selectedContact.set(contact);
    this.conversationVisibility.reveal(this.chat.accountId(), 'direct', contact.jid);
    this.conversationSelection.set({
      kind: 'direct',
      accountId: this.chat.accountId(),
      jid: this.bareJid(contact.jid),
    });
    void this.scrollAfterConversationLoad(contact.jid);
  }
  protected useJid(): void {
    const jidInput = this.newMessageSearch().trim();
    const at = jidInput.indexOf('@');
    if (
      at > 0 &&
      at === jidInput.lastIndexOf('@') &&
      at < jidInput.length - 1 &&
      !/[\s/]/.test(jidInput)
    ) {
      this.followLatest();
      const jid = this.bareJid(jidInput);
      this.closeNewMessageDialog();
      this.draft.set('');
      this.mucDraft.set('');
      this.selectedContact.set(undefined);
      this.conversationVisibility.reveal(this.chat.accountId(), 'direct', jid);
      this.conversationSelection.set({ kind: 'direct', accountId: this.chat.accountId(), jid });
      void this.scrollAfterConversationLoad(jid);
    } else if (jidInput.includes('@')) {
      this.newMessageLocalError.set('Introduce un JID XMPP completo y válido.');
    }
  }
  protected selectJoinedRoom(roomJid: string): void {
    if (!this.joinedRoom(roomJid)) return;
    this.muc.select(roomJid);
    this.closeNewMessageDialog();
    this.draft.set('');
    this.mucDraft.set('');
    this.selectedContact.set(undefined);
    this.conversationVisibility.reveal(this.chat.accountId(), 'muc', roomJid);
    this.conversationSelection.set({ kind: 'muc', accountId: this.chat.accountId(), roomJid });
    this.followLatest();
  }
  protected selectRoomFromCatalog(roomJid: string): void {
    const room = this.joinedRoom(roomJid);
    if (room) {
      this.selectJoinedRoom(roomJid);
      return;
    }
    if (this.activeSelection().kind !== 'muc') this.muc.select(roomJid);
  }
  protected async send(): Promise<void> {
    const sentDraft = this.draft();
    try {
      const accepted = await this.chat.send(sentDraft, this.selectedJid());
      if (accepted && this.draft() === sentDraft) this.draft.set('');
    } catch {
      this.chat.error.set('No fue posible enviar el mensaje.');
    }
  }

  protected openBroadcast(): void {
    this.broadcastBody.set('');
    this.broadcastMode.set('normal');
    this.broadcastHideOffline.set(false);
    this.broadcastSelectedJids.set(new Set<string>());
    this.broadcastBusy.set(false);
    this.broadcastError.set(null);
    this.broadcastResult.set(null);
    this.broadcastOpen.set(true);
  }

  protected closeBroadcast(): void {
    if (this.broadcastBusy()) return;
    this.broadcastOpen.set(false);
    this.broadcastError.set(null);
    queueMicrotask(() => this.sidebar?.focusBroadcastTrigger());
  }

  protected toggleBroadcastContact(jid: string): void {
    const selected = new Set(this.broadcastSelectedJids());
    if (selected.has(jid)) selected.delete(jid);
    else selected.add(jid);
    this.broadcastSelectedJids.set(selected);
    this.broadcastError.set(null);
  }

  protected toggleBroadcastGroup(group: string): void {
    const groupJids = this.broadcastContacts()
      .filter((contact) => contact.groups.includes(group))
      .map((contact) => bareBroadcastJid(contact.jid));
    const selected = new Set(this.broadcastSelectedJids());
    const allSelected = groupJids.length > 0 && groupJids.every((jid) => selected.has(jid));
    groupJids.forEach((jid) => (allSelected ? selected.delete(jid) : selected.add(jid)));
    this.broadcastSelectedJids.set(selected);
    this.broadcastError.set(null);
  }

  protected toggleAllBroadcastContacts(): void {
    const allJids = this.broadcastContacts().map((contact) => bareBroadcastJid(contact.jid));
    const selected = this.broadcastSelectedJids();
    const allSelected = allJids.length > 0 && allJids.every((jid) => selected.has(jid));
    this.broadcastSelectedJids.set(
      allSelected ? new Set<string>() : new Set(allJids),
    );
    this.broadcastError.set(null);
  }

  protected async submitBroadcast(): Promise<void> {
    if (this.broadcastBusy()) return;
    const body = this.broadcastBody().trim();
    const currentJids = new Set(this.broadcastContacts().map((contact) => bareBroadcastJid(contact.jid)));
    const recipientJids = [...this.broadcastSelectedJids()].filter((jid) => currentJids.has(jid));
    if (!body) {
      this.broadcastError.set('Escribe un mensaje antes de difundirlo.');
      return;
    }
    if (!recipientJids.length) {
      this.broadcastError.set('Selecciona al menos un destinatario válido.');
      return;
    }
    if (!this.chat.isConnected() || !this.chat.accountId()) {
      this.broadcastError.set('La cuenta no está conectada.');
      return;
    }
    const run = ++this.broadcastRun;
    this.broadcastBusy.set(true);
    this.broadcastError.set(null);
    this.broadcastResult.set(null);
    try {
      const result = await this.broadcast.send({
        broadcastId: createOpaqueId('broadcast'),
        accountId: this.chat.accountId(),
        mode: this.broadcastMode(),
        body,
        recipientJids,
      });
      if (run !== this.broadcastRun) return;
      this.broadcastResult.set(result.recipients);
    } catch {
      if (run === this.broadcastRun)
        this.broadcastError.set('No fue posible completar la difusión.');
    } finally {
      if (run === this.broadcastRun) this.broadcastBusy.set(false);
    }
  }

  protected retryFailedBroadcast(): void {
    const failed = this.broadcastResult()
      ?.filter((item) => item.status === 'failed')
      .map((item) => item.recipientJid);
    if (!failed?.length) return;
    this.broadcastSelectedJids.set(new Set(failed));
    this.broadcastResult.set(null);
    this.broadcastError.set(null);
    void this.submitBroadcast();
  }

  private cancelBroadcastForAccount(): void {
    this.broadcastRun++;
    this.broadcastBusy.set(false);
    this.broadcastOpen.set(false);
  }
  protected draftChanged(value: string): void {
    this.draft.set(value);
    void this.chat.updateTypingState(this.selectedJid(), value);
  }
  protected typingFocus(): void {
    void this.chat.setTypingActivity(this.selectedJid(), 'active');
  }
  protected typingBlur(): void {
    void this.chat.setTypingActivity(this.selectedJid(), 'inactive');
  }
  protected async attach(): Promise<void> {
    await this.files.send(this.selectedJid());
  }
  protected dropFiles(files: ReadonlyArray<File>): void {
    const selection = this.activeSelection();
    if (selection.kind !== 'direct' || !this.selectedJid()) {
      this.files.error.set('Selecciona una conversación individual para enviar archivos.');
      return;
    }
    void this.files.sendDropped(selection.jid, files);
  }
  protected dropRejected(message: string): void {
    this.files.error.set(message);
  }

  @HostListener('document:dragover', ['$event'])
  protected protectFileDrag(event: DragEvent): void {
    if (!this.isFileDrag(event) || this.isConversationDropTarget(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  }

  @HostListener('document:drop', ['$event'])
  protected protectFileDrop(event: DragEvent): void {
    if (!this.isFileDrag(event) || this.isConversationDropTarget(event)) return;
    event.preventDefault();
  }
  protected async discoverRooms(): Promise<void> {
    this.mucDiscovering.set(true);
    try {
      await this.muc.discover(this.chat.accountId());
    } finally {
      this.mucDiscovering.set(false);
    }
  }
  protected async joinRoom(roomJid: string): Promise<void> {
    const accountId = this.chat.accountId();
    const nickname = this.mucNickname().trim() || accountId.split('@')[0] || 'operator';
    this.newMessageJoiningRoom.set(roomJid);
    try {
      await this.muc.join(accountId, roomJid, nickname);
      if (this.joinedRoom(roomJid)?.accountId === accountId) this.selectJoinedRoom(roomJid);
    } finally {
      this.newMessageJoiningRoom.set(null);
    }
  }
  protected async leaveRoom(): Promise<void> {
    const selection = this.activeSelection();
    if (selection.kind !== 'muc') return;
    await this.muc.leave(selection.accountId, selection.roomJid);
    if (!this.joinedRoom(selection.roomJid)) this.resetConversationSelection();
  }
  protected dismissConversationByUser(): void {
    const selection = this.activeSelection();
    if (selection.kind !== 'none' && this.chat.preferences().hideClosedConversations) {
      const jid = selection.kind === 'direct' ? selection.jid : selection.roomJid;
      this.conversationVisibility.hide(selection.accountId, selection.kind, jid);
    }
    if (selection.kind === 'muc') this.muc.clearSelection();
    this.conversationSelection.set({ kind: 'none', accountId: this.chat.accountId() });
    this.selectedContact.set(undefined);
    this.draft.set('');
    this.mucDraft.set('');
  }

  protected closeActiveConversation(): void {
    this.dismissConversationByUser();
  }
  protected async sendRoom(): Promise<void> {
    const selection = this.activeSelection();
    const sent = this.mucDraft();
    if (
      selection.kind === 'muc' &&
      (await this.muc.send(selection.accountId, selection.roomJid, sent)) &&
      this.mucDraft() === sent
    )
      this.mucDraft.set('');
  }
  protected updatePreferences(changes: Partial<Preferences>): void {
    void this.chat.updatePreferences(changes);
  }
  protected async resetPreferences(): Promise<void> {
    this.preferencesSaveState.set('saving');
    this.preferencesError.set(null);
    const saved = await this.chat.resetPreferences();
    this.theme.resetPreferences();
    if (saved) this.preferencesSaveState.set('saved');
    else {
      this.preferencesSaveState.set('error');
      this.preferencesError.set(
        this.chat.error() || 'No fue posible restablecer las preferencias.',
      );
    }
  }
  protected openNewMessageDialog(): void {
    this.newMessageSearch.set('');
    this.newMessageLocalError.set(null);
    this.newMessageOpen.set(true);
  }
  protected closeNewMessageDialog(): void {
    this.newMessageOpen.set(false);
    this.newMessageJoiningRoom.set(null);
    queueMicrotask(() => this.sidebar?.focusNewMessageTrigger());
  }
  protected setNewMessageSearch(value: string): void {
    this.newMessageSearch.set(value);
    this.newMessageLocalError.set(null);
  }
  protected openPreferences(): void {
    this.preferencesError.set(null);
    this.preferencesSaveState.set('idle');
    this.preferencesOpen.set(true);
  }
  protected closePreferences(): void {
    this.preferencesOpen.set(false);
    this.preferencesSaveState.set('idle');
    queueMicrotask(() => this.sidebar?.focusPreferencesTrigger());
  }
  protected async savePreferenceChange(changes: Partial<Preferences>): Promise<void> {
    this.preferencesSaveState.set('saving');
    this.preferencesError.set(null);
    const saved = await this.chat.updatePreferences(changes);
    if (saved) this.preferencesSaveState.set('saved');
    else {
      this.preferencesSaveState.set('error');
      this.preferencesError.set(this.chat.error() || 'No fue posible guardar la preferencia.');
    }
  }
  protected async selectDownloadDirectory(): Promise<void> {
    if (this.downloadDirectorySelecting()) return;
    this.downloadDirectorySelecting.set(true);
    this.preferencesError.set(null);
    try {
      const result = await this.chat.selectDownloadDirectory();
      if (!result.ok) {
        this.preferencesSaveState.set('error');
        this.preferencesError.set(result.error.message);
      } else if (result.value) {
        await this.savePreferenceChange({ downloadDirectory: result.value });
      }
    } finally {
      this.downloadDirectorySelecting.set(false);
    }
  }
  protected onUserScrollIntent(): void {
    this.conversationView?.onUserScrollIntent();
  }
  protected onChatScroll(): void {
    this.conversationView?.onChatScroll({
      historyLoading: this.chat.historyLoading(),
      hasOlderMessages: this.chat.hasOlderMessages(),
      hasNewerMessages: this.chat.hasNewerMessages(),
    });
  }

  private async scrollAfterConversationLoad(jid: string): Promise<void> {
    await this.chat.loadConversation(jid);
    if (this.bareJid(this.selectedJid()) !== this.bareJid(jid)) return;
    this.conversationView?.scrollToLatest(jid);
  }
  protected async loadOlderMessages(request: OlderMessagesRequest): Promise<void> {
    await this.chat.loadOlderMessages(request.conversation);
    this.conversationView?.restoreScrollAfterPrepend(request);
  }
  protected async loadNewerMessages(conversation: string): Promise<void> {
    await this.chat.loadNewerMessages(conversation);
  }
  private selectedPresenceOption(): PresenceOption {
    return (
      this.presenceOptions.find((option) => {
        const current = this.chat.presence();
        return (
          option.mode === current.mode &&
          (option.id !== 'phone' || current.status === 'Al teléfono') &&
          (option.id !== 'away' || current.status !== 'Al teléfono')
        );
      }) || this.presenceOptions[1]
    );
  }
  private directSenderLabel(message: Message): string {
    if (message.accountId !== this.chat.accountId()) return 'Remitente desconocido';
    if (this.isOutgoing(message)) return 'Tú';
    const senderJid = this.bareJid(message.senderJid);
    if (!senderJid) return 'Remitente desconocido';
    const contact = this.chat.contacts().find((item) => this.bareJid(item.jid) === senderJid);
    return contact?.name?.trim() || senderJid;
  }
  private isOutgoing(message: Message): boolean {
    const sender = this.bareJid(message.senderJid);
    const account = this.chat.accountId().toLowerCase();
    return sender === account || sender.startsWith(`${account}@`);
  }
  private bareJid(jid: string): string {
    return jid.split('/')[0].toLowerCase();
  }
  private isFileDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }
  private isConversationDropTarget(event: DragEvent): boolean {
    const target = event.target;
    return target instanceof Element && Boolean(target.closest('.conversation-surface'));
  }
  private joinedRoom(roomJid: string): RoomState | undefined {
    return this.muc
      .states()
      .find(
        (state) =>
          state.room.jid === roomJid &&
          state.accountId === this.chat.accountId() &&
          state.status === 'joined',
      );
  }
  private followLatest(): void {
    this.conversationView?.scrollToLatest(this.selectedJid());
  }
  private resetConversationSelection(): void {
    if (this.activeSelection().kind === 'muc') this.muc.clearSelection();
    this.conversationSelection.set({ kind: 'none', accountId: this.chat.accountId() });
    this.selectedContact.set(undefined);
    this.draft.set('');
    this.mucDraft.set('');
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    if (this.theme.editorOpen()) {
      event.preventDefault();
      this.theme.cancelStudio();
      return;
    }
    if (this.certificateRequest() || this.presenceOpen()) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[role="dialog"], [role="menu"], [aria-modal="true"]')
    )
      return;
    if (this.activeSelection().kind === 'none') return;
    event.preventDefault();
    this.dismissConversationByUser();
  }
}
