import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  HostListener,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { ChatFacade } from './core/facades/chat.facade';
import { AppSessionCoordinator } from './core/coordinators/app-session.coordinator';
import type { LoginDraft } from './core/coordinators/app-session.coordinator';
import { MucFacade } from './core/facades/muc.facade';
import { FileFacade } from './core/facades/file.facade';
import {
  Contact,
  CredentialStorageStatus,
  HistoryTimelineItem,
  Message,
  MessageSearchHit,
  Preferences,
  RoomMessage,
} from './core/domain';
import { BroadcastFacade } from './core/facades/broadcast.facade';
import { BroadcastCoordinator } from './core/coordinators/broadcast.coordinator';
import { CertificateDialogComponent } from './features/session/certificate-dialog.component';
import {
  ConversationViewComponent,
  OlderMessagesRequest,
} from './features/conversation/conversation-view.component';
import { LoginPanelComponent } from './features/session/login-panel.component';
import { ConnectionSettingsDialogComponent } from './features/settings/connection-settings-dialog.component';
import type { ConnectionSettingsDraft } from './features/settings/connection-settings-dialog.component';
import { MucViewComponent } from './features/muc/muc-view.component';
import { SidebarComponent } from './features/navigation/sidebar.component';
import { PresenceOption } from './features/navigation/sidebar.models';
import { ActiveConversationStore } from './core/stores/active-conversation.store';
import { WindowFocusStore } from './core/stores/window-focus.store';
import { ConversationVisibilityStore } from './core/stores/conversation-visibility.store';
import { ThemeService } from './core/theme.service';
import { NewMessageDialogComponent } from './features/navigation/new-message-dialog.component';
import { PreferencesDialogComponent } from './features/settings/preferences-dialog.component';
import { BroadcastDialogComponent } from './features/broadcast/broadcast-dialog.component';
import { StickerMessageFacade } from './core/facades/sticker-message.facade';
import { UpdateFacade } from './core/facades/update.facade';
import { PreferencesCoordinator } from './core/coordinators/preferences.coordinator';
import { NewMessageCoordinator } from './core/coordinators/new-message.coordinator';
import { ConversationTimelineCoordinator } from './core/coordinators/conversation-timeline.coordinator';
import { WorkspaceCoordinator } from './core/coordinators/workspace.coordinator';
import { WorkspaceConversationViewCoordinator } from './features/navigation/workspace-conversation-view.coordinator';
import { SidebarViewCoordinator } from './features/navigation/sidebar-view.coordinator';
import { bareJid } from './core/identity';
import { VersionUpdateComponent } from './features/session/version-update.component';
import { GameFacade } from './features/games/game.facade';
import type { GameSessionDto } from './core/domain';

import {
  STICKER_SENDING_DISABLED_MESSAGE,
  stickerSendErrorMessage,
} from './features/stickers/sticker-send-error-message';
export {
  STICKER_SENDING_DISABLED_MESSAGE,
  stickerSendErrorMessage,
} from './features/stickers/sticker-send-error-message';

@Component({
  selector: 'app-root',
  imports: [
    VersionUpdateComponent,
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
  private readonly session = inject(AppSessionCoordinator);
  protected readonly muc = inject(MucFacade);
  private readonly workspace = inject(WorkspaceCoordinator);
  private readonly activeConversation = inject(ActiveConversationStore);
  private readonly conversationVisibility = inject(ConversationVisibilityStore);
  private readonly windowFocus = inject(WindowFocusStore);
  protected readonly files = inject(FileFacade);
  protected readonly stickerMessages = inject(StickerMessageFacade);
  protected readonly games = inject(GameFacade);
  protected readonly updates = inject(UpdateFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly stickerSendingDisabled = true;
  protected readonly theme = inject(ThemeService);
  private readonly preferencesCoordinator = new PreferencesCoordinator({
    chat: this.chat,
    updates: this.updates,
    resetTheme: () => this.theme.resetPreferences(),
  });
  private readonly newMessageCoordinator = new NewMessageCoordinator({
    chat: this.chat,
    muc: this.muc,
    isJoinedRoom: (accountId, roomJid) =>
      this.workspace.joinedRoom(roomJid)?.accountId === accountId,
    selectJoinedRoom: (roomJid) => this.selectJoinedRoom(roomJid),
    joinedRooms: this.workspace.joinedRooms,
  });
  private readonly conversationTimelineCoordinator = new ConversationTimelineCoordinator({
    chat: this.chat,
    files: this.files,
    selectedJid: () => this.selectedJid(),
    contactsByBareJid: () => this.contactsByBareJid(),
  });
  private readonly workspaceConversationViewCoordinator = new WorkspaceConversationViewCoordinator({
    conversationSummaries: this.chat.conversationSummaries,
    joinedRooms: this.workspace.joinedRooms,
    search: this.workspace.search,
    roomActivity: this.muc.roomActivity,
    contactsByBareJid: this.workspace.contactsByBareJid,
    isHidden: (accountId, kind, jid) => this.conversationVisibility.isHidden(accountId, kind, jid),
  });
  private readonly sidebarViewCoordinator = new SidebarViewCoordinator({
    connection: this.chat.connection,
    accountId: this.chat.accountId,
    presence: this.chat.presence,
    search: this.workspace.search,
    unreadCounts: this.chat.unreadCounts,
    nickname: this.newMessageCoordinator.nickname,
    discovering: this.newMessageCoordinator.discovering,
    mucError: this.muc.error,
    services: this.muc.services,
    mucStates: this.muc.states,
    selectedRoomJid: this.muc.selectedRoomJid,
    activeRoomState: this.workspace.activeRoomState,
    joinedRooms: this.workspace.joinedRooms,
    filteredContacts: this.workspace.filteredContacts,
    workspaceContacts: this.workspace.workspaceContacts,
    workspaceItems: this.workspaceConversationViewCoordinator.items,
    selectedJid: this.workspace.selectedJid,
  });
  private readonly broadcast = inject(BroadcastFacade);
  private readonly broadcastCoordinator = new BroadcastCoordinator({
    sender: this.broadcast,
    accountId: () => this.chat.accountId(),
    isConnected: () => this.chat.isConnected(),
    contacts: () => this.chat.contacts(),
  });
  protected readonly fileActionPending = (transferId: string): boolean =>
    this.files.isLocalActionPending(transferId);
  protected readonly draft = signal('');
  protected readonly replyingTo = signal<
    { readonly id: string; readonly author: string; readonly quote: string } | undefined
  >(undefined);
  protected readonly login = this.session.login;
  protected readonly loginBusy = this.session.loginBusy;
  protected readonly profileActionBusy = this.session.profileActionBusy;
  protected readonly selectedProfileId = this.session.selectedProfileId;
  protected readonly loginProfiles = this.session.loginProfiles;
  protected readonly credentialStorageStatus = computed<CredentialStorageStatus>(
    () =>
      this.loginProfiles().find((profile) => profile.accountId === this.selectedProfileId())
        ?.credentialStorageStatus || 'available',
  );
  protected readonly search = this.workspace.search;
  protected readonly messageSearchQuery = signal('');
  protected readonly messageSearchScope = signal<'all' | 'conversation'>('conversation');
  protected readonly gamesOpen = signal(false);
  protected readonly messageSearchConversationNames = this.workspace.messageSearchConversationNames;
  private messageSearchTimer: ReturnType<typeof setTimeout> | undefined;
  private messageSearchNavigationGeneration = 0;
  private gamesContext = '';
  private destroyed = false;
  private uiTaskGeneration = 0;
  private newMessageFocusFrame: number | undefined;
  protected readonly newMessageOpen = this.newMessageCoordinator.open;
  protected readonly newMessageSearch = this.newMessageCoordinator.search;
  protected readonly newMessageJoiningRoom = this.newMessageCoordinator.joiningRoom;
  protected readonly newMessageLocalError = this.newMessageCoordinator.localError;
  protected readonly preferencesOpen = this.preferencesCoordinator.open;
  protected readonly broadcastOpen = this.broadcastCoordinator.open;
  protected readonly broadcastBody = this.broadcastCoordinator.body;
  protected readonly broadcastMode = this.broadcastCoordinator.mode;
  protected readonly broadcastHideOffline = this.broadcastCoordinator.hideOffline;
  protected readonly broadcastSelectedJids = this.broadcastCoordinator.selectedJids;
  protected readonly broadcastBusy = this.broadcastCoordinator.busy;
  protected readonly broadcastError = this.broadcastCoordinator.error;
  protected readonly broadcastResult = this.broadcastCoordinator.result;
  protected readonly preferencesSaveState = this.preferencesCoordinator.saveState;
  protected readonly preferencesError = this.preferencesCoordinator.error;
  protected readonly downloadDirectorySelecting =
    this.preferencesCoordinator.downloadDirectorySelecting;
  protected readonly totalUnread = computed(() => this.chat.unreadTotal?.() ?? 0);
  protected readonly conversationError = computed(() => this.files.error() || this.chat.error());
  protected readonly conversationSelection = this.workspace.conversationSelection;
  protected readonly selectedContact = this.workspace.selectedContact;
  protected readonly settingsOpen = this.session.settingsOpen;
  protected readonly settingsSaving = this.session.settingsSaving;
  protected readonly settingsError = this.session.settingsError;
  protected readonly settingsDraft = this.session.settingsDraft;
  protected readonly certificateRequest = this.session.certificateRequest;
  protected readonly presenceOpen = this.sidebarViewCoordinator.presenceOpen;
  protected readonly presenceStatus = this.sidebarViewCoordinator.presenceStatus;
  protected readonly mucNickname = this.newMessageCoordinator.nickname;
  protected readonly mucDraft = signal('');
  protected readonly mucDiscovering = this.newMessageCoordinator.discovering;
  protected readonly newMessageContacts = this.newMessageCoordinator.contacts;
  protected readonly newMessageServices = this.newMessageCoordinator.services;
  protected readonly newMessageDialogModel = this.newMessageCoordinator.dialogModel;
  protected readonly preferencesDialogModel = this.preferencesCoordinator.dialogModel;
  protected readonly broadcastContacts = this.broadcastCoordinator.contacts;
  protected readonly broadcastGroups = this.broadcastCoordinator.groups;
  protected readonly broadcastDialogModel = this.broadcastCoordinator.dialogModel;
  protected readonly activeSelection = this.workspace.activeSelection;
  protected readonly selectedJid = this.workspace.selectedJid;
  protected readonly joinedRooms = this.workspace.joinedRooms;
  private readonly contactsByBareJid = this.workspace.contactsByBareJid;
  protected readonly workspaceContacts = this.workspace.workspaceContacts;
  protected readonly workspaceItems = this.workspaceConversationViewCoordinator.items;
  protected readonly activeRoomState = this.workspace.activeRoomState;
  protected readonly filteredContacts = this.workspace.filteredContacts;
  protected readonly visibleMessages = this.conversationTimelineCoordinator.visibleMessages;
  protected readonly initialTimelineReady =
    this.conversationTimelineCoordinator.initialTimelineReady;
  protected readonly typingContact = computed(() => {
    const jid = bareJid(this.selectedJid());
    if (!jid || this.chat.chatStates?.().get(jid) !== 'composing') return '';
    const contactName = this.contactsByBareJid().get(jid)?.name?.trim();
    if (contactName) return contactName;
    const localPart = jid.split('@')[0]?.trim();
    return localPart
      ? `${localPart.charAt(0).toLocaleUpperCase()}${localPart.slice(1)}`
      : 'Contacto';
  });
  protected readonly conversationTimeline = this.conversationTimelineCoordinator.timeline;
  protected readonly activeContact = computed(() => {
    const jid = bareJid(this.selectedJid());
    return this.contactsByBareJid().get(jid);
  });
  protected readonly presenceOptions = this.sidebarViewCoordinator.presenceOptions;
  protected readonly sidebarModel = this.sidebarViewCoordinator.model;
  @ViewChild(LoginPanelComponent) private loginPanel?: LoginPanelComponent;
  @ViewChild(ConversationViewComponent) private conversationView?: ConversationViewComponent;
  @ViewChild(MucViewComponent) private mucView?: MucViewComponent;
  @ViewChild(NewMessageDialogComponent) private newMessageDialog?: NewMessageDialogComponent;
  @ViewChild('preferencesFallbackClose')
  private set preferencesFallbackClose(button: ElementRef<HTMLButtonElement> | undefined) {
    if (!button) return;
    this.scheduleUiMicrotask(() => {
      if (this.preferencesOpen() && button.nativeElement.isConnected) button.nativeElement.focus();
    });
  }
  @ViewChild('broadcastFallbackClose')
  private set broadcastFallbackClose(button: ElementRef<HTMLButtonElement> | undefined) {
    if (!button) return;
    this.scheduleUiMicrotask(() => {
      if (this.broadcastOpen() && button.nativeElement.isConnected) button.nativeElement.focus();
    });
  }
  @ViewChild(SidebarComponent) private sidebar?: SidebarComponent;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.uiTaskGeneration += 1;
      if (this.messageSearchTimer) clearTimeout(this.messageSearchTimer);
      this.messageSearchTimer = undefined;
      this.cancelNewMessageFocus();
      this.broadcastCoordinator.destroy();
      this.preferencesCoordinator.destroy();
      this.newMessageCoordinator.destroy();
    });
    void this.session.tryAutoLogin();
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
    effect(() => {
      const selection = this.activeSelection();
      const accountId = this.chat.accountId();
      const context =
        selection.kind === 'direct' && accountId ? `${accountId}|${selection.jid}` : '';
      if (context !== this.gamesContext) {
        this.gamesContext = context;
        this.gamesOpen.set(false);
      }
      if (selection.kind === 'direct' && accountId && selection.jid)
        this.games.openConversation(accountId, selection.jid);
      else this.games.closeConversation();
    });
    this.destroyRef.onDestroy(() => this.games.destroy());
  }

  protected setLoginAccount(accountId: string): void {
    this.session.setLoginAccount(accountId);
  }
  protected setLoginDomain(domain: string): void {
    this.session.setLoginDomain(domain);
  }
  protected setLoginPassword(password: string): void {
    this.session.setLoginPassword(password);
  }
  protected setLoginHost(host: string): void {
    this.session.setLoginHost(host);
  }
  protected setLoginPort(port: number): void {
    this.session.setLoginPort(port);
  }
  protected setLoginTransport(transport: LoginDraft['transport']): void {
    this.session.setLoginTransport(transport);
  }
  protected setLoginAutomatic(automatic: boolean): void {
    this.session.setLoginAutomatic(automatic);
  }
  protected setLoginRemember(remember: boolean): void {
    this.session.setLoginRemember(remember);
  }
  protected setLoginAutoLogin(autoLogin: boolean): void {
    this.session.setLoginAutoLogin(autoLogin);
  }
  protected async selectLoginProfile(accountId: string): Promise<void> {
    await this.session.selectLoginProfile(accountId);
  }
  protected async forgetLoginSecret(): Promise<void> {
    await this.session.forgetLoginSecret();
  }
  protected async recoverSecretStorage(): Promise<void> {
    const accountId = this.selectedProfileId();
    if (!accountId) return;
    await this.session.recoverSecretStorage(accountId);
  }
  protected async resetSecretStorage(): Promise<void> {
    const accountId = this.selectedProfileId();
    if (!accountId) return;
    await this.session.resetSecretStorage(accountId);
  }
  protected async deleteLoginProfile(): Promise<void> {
    await this.session.deleteLoginProfile();
  }
  protected openAdvancedSettings(): void {
    this.session.openAdvancedSettings();
  }
  protected cancelAdvancedSettings(): void {
    this.session.cancelAdvancedSettings();
    this.scheduleUiMicrotask(() => this.loginPanel?.focusAdvancedSettings());
  }
  protected saveAdvancedSettings(settings: ConnectionSettingsDraft): Promise<void> {
    return this.session.saveAdvancedSettings(settings).then(() => {
      if (!this.settingsOpen())
        this.scheduleUiMicrotask(() => this.loginPanel?.focusAdvancedSettings());
    });
  }
  protected connectionLabel(): string {
    return this.sidebarViewCoordinator.connectionLabel();
  }
  protected presenceLabel(): string {
    return this.sidebarViewCoordinator.presenceLabel();
  }
  protected presenceDot(): string {
    return this.sidebarViewCoordinator.presenceDot();
  }
  protected async choosePresence(option: PresenceOption): Promise<void> {
    const status =
      option.id === 'phone' ? 'Al teléfono' : option.id === 'away' ? '' : this.presenceStatus();
    await this.chat.setPresence(option.mode, status);
    this.presenceOpen.set(false);
  }
  protected inviteGame(input: { gameId: string; gameVersion: string }): void {
    this.gamesOpen.set(false);
    void this.games.invite(input.gameId, input.gameVersion);
  }
  protected toggleGames(): void {
    if (!this.selectedJid()) return;
    this.gamesOpen.update((open) => !open);
  }
  protected acceptGame(session: GameSessionDto): void {
    void this.games.accept(session);
  }
  protected rejectGame(session: GameSessionDto): void {
    void this.games.reject(session);
  }
  protected cancelGame(session: GameSessionDto): void {
    void this.games.cancel(session);
  }
  protected moveGame(input: { session: GameSessionDto; move: unknown }): void {
    void this.games.move(input.session, input.move);
  }
  protected resignGame(session: GameSessionDto): void {
    void this.games.resign(session);
  }
  protected resyncGame(session: GameSessionDto): void {
    void this.games.resync(session);
  }
  protected rematchGame(session: GameSessionDto): void {
    void this.games.rematch(session);
  }
  protected closeGame(session: GameSessionDto): void {
    void this.games.close(session);
  }
  protected async connect(): Promise<void> {
    this.resetConversationSelection();
    await this.session.connect();
  }
  protected async disconnect(): Promise<void> {
    this.cancelBroadcastForAccount();
    this.resetConversationSelection();
    await this.session.disconnect();
  }
  protected decideCertificate(
    decision: Parameters<AppSessionCoordinator['decideCertificate']>[0],
  ): Promise<void> {
    return this.session.decideCertificate(decision);
  }
  protected selectContact(contact: Contact): void {
    this.messageSearchNavigationGeneration += 1;
    this.closeNewMessageDialog();
    if (this.isSelectedDirectConversation(contact.jid)) return;
    this.followLatest();
    this.draft.set('');
    this.mucDraft.set('');
    this.workspace.selectDirect(contact.jid, contact);
    this.refreshMessageSearchForSelection();
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
      this.messageSearchNavigationGeneration += 1;
      const jid = bareJid(jidInput);
      this.closeNewMessageDialog();
      if (this.isSelectedDirectConversation(jid)) return;
      this.followLatest();
      this.draft.set('');
      this.mucDraft.set('');
      this.workspace.selectDirect(jid);
      this.refreshMessageSearchForSelection();
      void this.scrollAfterConversationLoad(jid);
    } else if (jidInput.includes('@')) {
      this.newMessageLocalError.set('Introduce un JID XMPP completo y válido.');
    }
  }
  protected selectJoinedRoom(roomJid: string): void {
    if (!this.workspace.selectJoinedRoom(roomJid)) return;
    this.messageSearchNavigationGeneration += 1;
    this.closeNewMessageDialog();
    this.draft.set('');
    this.mucDraft.set('');
    this.followLatest();
  }
  protected selectRoomFromCatalog(roomJid: string): void {
    const room = this.workspace.joinedRoom(roomJid);
    if (room) {
      this.selectJoinedRoom(roomJid);
      return;
    }
    if (this.activeSelection().kind !== 'muc') this.muc.select(roomJid);
  }
  protected async send(): Promise<void> {
    const sentDraft = this.draft();
    const replyId = this.replyingTo()?.id;
    try {
      const accepted = await this.chat.sendMessageWithReply(sentDraft, this.selectedJid(), replyId);
      if (accepted && this.draft() === sentDraft) {
        this.draft.set('');
        this.replyingTo.set(undefined);
      }
    } catch {
      this.chat.error.set('No fue posible enviar el mensaje.');
    }
  }

  protected async sendSticker(stickerId: string): Promise<void> {
    if (this.stickerSendingDisabled) {
      this.chat.error.set(STICKER_SENDING_DISABLED_MESSAGE);
      return;
    }
    const conversationId = this.selectedJid();
    const accountId = this.chat.accountId();
    if (!accountId || !conversationId || !this.chat.isConnected()) return;
    const result = await this.stickerMessages.send(accountId, conversationId, stickerId);
    if (result.ok) this.chat.upsertStickerMessage(result.value);
    else this.chat.error.set(stickerSendErrorMessage(result.error));
  }

  protected async loadSticker(refId: string): Promise<void> {
    const item = this.chat
      .timelineItems()
      .find(
        (candidate): candidate is Extract<HistoryTimelineItem, { kind: 'sticker' }> =>
          candidate.kind === 'sticker' && candidate.sticker.refId === refId,
      );
    if (!item) return;
    const result = await this.stickerMessages.load(item.sticker);
    if (result.ok) this.chat.upsertStickerMessage(result.value);
    else this.chat.error.set('No se pudo cargar el sticker.');
  }

  protected async saveSticker(refId: string): Promise<void> {
    const item = this.chat
      .timelineItems()
      .find(
        (candidate): candidate is Extract<HistoryTimelineItem, { kind: 'sticker' }> =>
          candidate.kind === 'sticker' && candidate.sticker.refId === refId,
      );
    if (!item) return;
    const result = await this.stickerMessages.save(item.sticker);
    if (result.ok) this.chat.upsertStickerMessage(result.value);
    else {
      this.chat.upsertStickerMessage({
        ...item.sticker,
        errorCode: 'STORAGE_FAILED',
        updatedAt: new Date().toISOString(),
      });
      this.chat.error.set('No se pudo guardar el sticker en Mis stickers.');
    }
  }

  protected openBroadcast(): void {
    this.broadcastCoordinator.openDialog();
  }

  protected closeBroadcast(): void {
    if (this.broadcastCoordinator.closeDialog()) this.focusBroadcastTrigger();
  }

  protected toggleBroadcastContact(jid: string): void {
    this.broadcastCoordinator.toggleContact(jid);
  }

  protected toggleBroadcastGroup(group: string): void {
    this.broadcastCoordinator.toggleGroup(group);
  }

  protected toggleAllBroadcastContacts(): void {
    this.broadcastCoordinator.toggleAll();
  }

  protected async submitBroadcast(): Promise<void> {
    if (await this.broadcastCoordinator.submit()) this.focusBroadcastTrigger();
  }

  protected async retryFailedBroadcast(): Promise<void> {
    if (await this.broadcastCoordinator.retryFailed()) this.focusBroadcastTrigger();
  }

  private cancelBroadcastForAccount(): void {
    this.broadcastCoordinator.cancelForAccount();
  }

  private focusBroadcastTrigger(): void {
    this.scheduleUiMicrotask(() => this.sidebar?.focusBroadcastTrigger());
  }
  protected draftChanged(value: string): void {
    this.draft.set(value);
    void this.chat.updateTypingState(this.selectedJid(), value);
  }
  protected searchMessages(query: string): void {
    this.messageSearchQuery.set(query);
    if (this.messageSearchTimer) clearTimeout(this.messageSearchTimer);
    this.messageSearchTimer = setTimeout(() => {
      this.messageSearchTimer = undefined;
      void this.runMessageSearch();
    }, 180);
  }
  protected changeMessageSearchScope(scope: 'all' | 'conversation'): void {
    this.messageSearchScope.set(scope);
    void this.runMessageSearch();
  }
  protected loadMoreMessageSearch(): void {
    void this.chat.searchMessages(
      this.messageSearchQuery(),
      this.currentMessageSearchScope(),
      true,
    );
  }
  protected async selectMessageSearchHit(hit: MessageSearchHit): Promise<void> {
    if (hit.accountId !== this.chat.accountId()) return;
    const navigationGeneration = ++this.messageSearchNavigationGeneration;
    this.conversationView?.beginSearchNavigation({
      accountId: hit.accountId,
      conversation: hit.conversationId,
    });
    const contact = this.chat
      .contacts()
      .find((item) => bareJid(item.jid) === bareJid(hit.conversationId)) || {
      jid: hit.conversationId,
      name: hit.conversationId,
      groups: [],
      source: 'conversation' as const,
    };
    this.workspace.selectDirect(hit.conversationId, contact);
    this.refreshMessageSearchForSelection();
    await this.chat.revealSearchHit(hit);
    const selection = this.activeSelection();
    if (
      navigationGeneration !== this.messageSearchNavigationGeneration ||
      hit.accountId !== this.chat.accountId() ||
      selection.kind !== 'direct' ||
      selection.accountId !== hit.accountId ||
      bareJid(selection.jid) !== bareJid(hit.conversationId)
    )
      return;
    this.conversationView?.scrollToMessage(hit.messageId);
  }
  private currentMessageSearchScope():
    { readonly kind: 'all' } | { readonly kind: 'conversation'; readonly conversationId: string } {
    return this.messageSearchScope() === 'all' || !this.selectedJid()
      ? { kind: 'all' }
      : { kind: 'conversation', conversationId: bareJid(this.selectedJid()) };
  }
  private runMessageSearch(): Promise<void> {
    return this.chat.searchMessages(this.messageSearchQuery(), this.currentMessageSearchScope());
  }
  private refreshMessageSearchForSelection(): void {
    if (this.messageSearchScope() === 'conversation' && this.messageSearchQuery().trim())
      void this.runMessageSearch();
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
  protected pasteFiles(files: ReadonlyArray<File>): void {
    const selection = this.activeSelection();
    if (selection.kind !== 'direct' || !this.selectedJid()) {
      this.files.error.set('Selecciona una conversación individual para pegar archivos.');
      return;
    }
    void this.files.sendClipboard(selection.jid, files);
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
    await this.newMessageCoordinator.discoverRooms();
  }
  protected async joinRoom(roomJid: string): Promise<void> {
    await this.newMessageCoordinator.joinRoom(roomJid);
  }
  protected async leaveRoom(): Promise<void> {
    const selection = this.activeSelection();
    if (selection.kind !== 'muc') return;
    await this.muc.leave(selection.accountId, selection.roomJid);
    if (!this.workspace.joinedRoom(selection.roomJid)) this.resetConversationSelection();
  }
  protected dismissConversationByUser(): void {
    this.workspace.dismissConversation(this.chat.preferences().hideClosedConversations);
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
      (await this.muc.send(selection.accountId, selection.roomJid, sent, this.replyingTo()?.id)) &&
      this.mucDraft() === sent
    ) {
      this.mucDraft.set('');
      this.replyingTo.set(undefined);
    }
  }
  protected startReply(message: Message | RoomMessage, muc: boolean): void {
    if (muc) {
      if ('roomJid' in message) {
        const roomStanzaId = message.stanzaIds?.find(
          (item) => item.by.toLowerCase() === message.roomJid.toLowerCase(),
        )?.id;
        if (roomStanzaId) {
          this.replyingTo.set({
            id: roomStanzaId,
            author: this.mucLabel(message),
            quote: this.replyQuote(message.body.text),
          });
          this.focusReplyComposer(true);
        }
      }
      return;
    }
    if ('conversationId' in message) {
      const targetId = message.originId || message.messageId || message.stanzaIds?.[0]?.id;
      if (targetId) {
        this.replyingTo.set({
          id: targetId,
          author: this.conversationTimelineCoordinator.directSenderLabel(message),
          quote: this.replyQuote(message.body.text),
        });
        this.focusReplyComposer(false);
      }
    }
  }
  protected cancelReply(): void {
    this.replyingTo.set(undefined);
  }

  private focusReplyComposer(muc: boolean): void {
    this.scheduleUiMicrotask(() => {
      if (muc) this.mucView?.focusComposer();
      else this.conversationView?.focusComposer();
    });
  }

  protected async changeReaction(
    messageId: string,
    emojis: ReadonlyArray<string>,
    muc: boolean,
  ): Promise<void> {
    const selection = this.activeSelection();
    if (muc && selection.kind === 'muc')
      await this.muc.sendReaction(selection.accountId, selection.roomJid, messageId, emojis);
    if (!muc && selection.kind === 'direct')
      await this.chat.sendReaction(selection.jid, messageId, emojis);
  }
  private mucLabel(message: import('./core/domain').RoomMessage): string {
    return message.occupantJid.split('/').slice(1).join('/') || message.occupantJid;
  }
  private replyQuote(value: string): string {
    const text = Array.from(value);
    return text.length > 180 ? `${text.slice(0, 179).join('')}…` : value;
  }
  protected updatePreferences(changes: Partial<Preferences>): void {
    void this.chat.updatePreferences(changes);
  }
  protected async resetPreferences(): Promise<void> {
    await this.preferencesCoordinator.reset();
  }
  protected openNewMessageDialog(): void {
    this.cancelNewMessageFocus();
    this.newMessageCoordinator.openDialog();
    const generation = this.uiTaskGeneration;
    this.scheduleUiMicrotask(() => {
      if (!this.newMessageOpen() || generation !== this.uiTaskGeneration) return;
      this.newMessageFocusFrame = requestAnimationFrame(() => {
        this.newMessageFocusFrame = undefined;
        if (this.destroyed || generation !== this.uiTaskGeneration || !this.newMessageOpen())
          return;
        this.newMessageDialog?.focusSearch();
      });
    });
  }
  protected closeNewMessageDialog(): void {
    this.cancelNewMessageFocus();
    this.newMessageCoordinator.closeDialog();
    this.scheduleUiMicrotask(() => this.sidebar?.focusNewMessageTrigger());
  }
  protected setNewMessageSearch(value: string): void {
    this.newMessageCoordinator.setSearch(value);
  }
  protected openPreferences(): void {
    this.preferencesCoordinator.openDialog();
  }
  protected checkForUpdates(): void {
    this.preferencesCoordinator.checkForUpdates();
  }
  protected downloadUpdate(): void {
    this.preferencesCoordinator.downloadUpdate();
  }
  protected installUpdate(): void {
    this.preferencesCoordinator.installUpdate();
  }
  protected closePreferences(): void {
    this.preferencesCoordinator.closeDialog();
    this.scheduleUiMicrotask(() => this.sidebar?.focusPreferencesTrigger());
  }
  protected async savePreferenceChange(changes: Partial<Preferences>): Promise<void> {
    await this.preferencesCoordinator.save(changes);
  }
  protected async selectDownloadDirectory(): Promise<void> {
    await this.preferencesCoordinator.selectDownloadDirectory();
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
    if (bareJid(this.selectedJid()) !== bareJid(jid)) return;
    this.conversationView?.scrollToLatest(jid);
  }
  protected async loadOlderMessages(request: OlderMessagesRequest): Promise<void> {
    try {
      await this.chat.loadOlderMessages(request.conversation);
    } finally {
      this.conversationView?.restoreScrollAfterPrepend(request);
    }
  }
  protected async loadNewerMessages(conversation: string): Promise<void> {
    await this.chat.loadNewerMessages(conversation);
  }
  private selectedPresenceOption(): PresenceOption {
    return this.sidebarViewCoordinator.selectedPresenceOption();
  }

  private isSelectedDirectConversation(jid: string): boolean {
    const selection = this.activeSelection();
    return selection.kind === 'direct' && bareJid(selection.jid) === bareJid(jid);
  }

  private isFileDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }
  private isConversationDropTarget(event: DragEvent): boolean {
    const target = event.target;
    return target instanceof Element && Boolean(target.closest('.conversation-surface'));
  }
  private followLatest(): void {
    this.conversationView?.scrollToLatest(this.selectedJid());
  }
  private resetConversationSelection(): void {
    this.messageSearchNavigationGeneration += 1;
    this.workspace.resetSelection();
    this.draft.set('');
    this.mucDraft.set('');
  }

  private scheduleUiMicrotask(task: () => void): void {
    const generation = this.uiTaskGeneration;
    queueMicrotask(() => {
      if (this.destroyed || generation !== this.uiTaskGeneration) return;
      task();
    });
  }

  private cancelNewMessageFocus(): void {
    if (this.newMessageFocusFrame === undefined) return;
    cancelAnimationFrame(this.newMessageFocusFrame);
    this.newMessageFocusFrame = undefined;
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (
      event.ctrlKey &&
      !event.metaKey &&
      event.key.toLowerCase() === 'f' &&
      !event.defaultPrevented &&
      !event.isComposing
    ) {
      if (
        this.certificateRequest() ||
        this.presenceOpen() ||
        this.preferencesOpen() ||
        this.broadcastOpen()
      )
        return;
      event.preventDefault();
      if (this.newMessageOpen()) this.newMessageDialog?.focusSearch();
      else this.openNewMessageDialog();
      return;
    }
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
    if (document.querySelector('.file-preview-overlay')) {
      event.preventDefault();
      return;
    }
    if (this.theme.editorOpen()) {
      event.preventDefault();
      this.theme.cancelStudio();
      return;
    }
    if (this.preferencesOpen()) {
      event.preventDefault();
      this.closePreferences();
      return;
    }
    if (this.broadcastOpen()) {
      event.preventDefault();
      if (!this.broadcastBusy()) this.closeBroadcast();
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
