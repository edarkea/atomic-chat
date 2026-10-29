import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  ViewChild,
  ViewEncapsulation,
} from '@angular/core';
import { ChatFacade } from './core/chat.facade';
import { MucFacade } from './core/muc.facade';
import { FileFacade } from './core/file.facade';
import { CertificateTrustDecision, Contact, Message, Preferences, RoomState } from './core/domain';
import { CertificateDialogComponent } from './certificate-dialog.component';
import {
  ConversationTimelineItem,
  ConversationViewComponent,
  OlderMessagesRequest,
} from './conversation-view.component';
import { LoginPanelComponent } from './login-panel.component';
import { MucViewComponent } from './muc-view.component';
import { SidebarComponent, SidebarModel } from './sidebar.component';
import { PresenceOption } from './sidebar.models';

type ConversationSelection =
  | { kind: 'none'; accountId: string }
  | { kind: 'direct'; accountId: string; jid: string }
  | { kind: 'muc'; accountId: string; roomJid: string };

@Component({
  selector: 'app-root',
  imports: [
    CertificateDialogComponent,
    ConversationViewComponent,
    LoginPanelComponent,
    MucViewComponent,
    SidebarComponent,
  ],
  templateUrl: './app.html',
  styleUrls: ['./app.scss', './certificate-dialog.scss', './file-transfer.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly chat = inject(ChatFacade);
  protected readonly muc = inject(MucFacade);
  protected readonly files = inject(FileFacade);
  protected readonly draft = signal('');
  protected readonly login = signal({ accountId: '', password: '' });
  protected readonly search = signal('');
  protected readonly conversationSelection = signal<ConversationSelection>({
    kind: 'none',
    accountId: '',
  });
  protected readonly selectedContact = signal<Contact | undefined>(undefined);
  protected readonly settingsOpen = signal(false);
  protected readonly certificateRequest = computed(() => this.chat.certificateRequest?.() ?? null);
  protected readonly presenceOpen = signal(false);
  protected readonly presenceStatus = signal('');
  protected readonly mucNickname = signal('');
  protected readonly mucDraft = signal('');
  protected readonly mucDiscovering = signal(false);
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
  protected readonly joinedRooms = computed(() =>
    this.muc
      .states()
      .filter((state) => state.accountId === this.chat.accountId() && state.status === 'joined'),
  );
  protected readonly activeRoomState = computed(() => {
    const selection = this.activeSelection();
    return selection.kind === 'muc' ? this.joinedRoom(selection.roomJid) : undefined;
  });
  protected readonly filteredContacts = computed(() => {
    const term = this.search().trim().toLowerCase();
    return this.chat
      .contacts()
      .filter(
        (contact) =>
          !term ||
          contact.jid.toLowerCase().includes(term) ||
          contact.name?.toLowerCase().includes(term),
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
      settingsOpen: this.settingsOpen(),
      preferences: this.chat.preferences(),
    },
    muc: {
      nickname: this.mucNickname(),
      discovering: this.mucDiscovering(),
      error: this.muc.error(),
      services: this.muc.services(),
      states: this.muc.states(),
      selectedRoomJid: this.muc.selectedRoomJid(),
      activeRoomState: this.activeRoomState(),
    },
    conversations: {
      search: this.search(),
      joinedRooms: this.joinedRooms(),
      filteredContacts: this.filteredContacts(),
      selectedJid: this.selectedJid(),
      selectedRoomJid: this.muc.selectedRoomJid(),
    },
  }));
  @ViewChild(ConversationViewComponent) private conversationView?: ConversationViewComponent;

  constructor() {
    void this.chat.tryAutoLogin();
    effect(() => {
      const account = this.chat.accountId();
      if (this.chat.isConnected() && account) void this.files.setAccount(account);
    });
  }

  protected setLoginAccount(accountId: string): void {
    this.login.update((value) => ({ ...value, accountId }));
  }
  protected setLoginPassword(password: string): void {
    this.login.update((value) => ({ ...value, password }));
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
    this.resetConversationSelection();
    this.muc.setAccount(this.login().accountId.trim());
    const connected = await this.chat.connect(this.login().accountId, this.login().password);
    if (connected) {
      this.login.update((value) => ({ ...value, password: '' }));
      await this.files.setAccount(this.chat.accountId());
    }
  }
  protected async disconnect(): Promise<void> {
    this.resetConversationSelection();
    await this.chat.disconnect();
    await this.files.setAccount('');
  }
  protected async decideCertificate(decision: CertificateTrustDecision): Promise<void> {
    await this.chat.decideCertificate(decision);
  }
  protected selectContact(contact: Contact): void {
    this.followLatest();
    this.selectedContact.set(contact);
    this.conversationSelection.set({
      kind: 'direct',
      accountId: this.chat.accountId(),
      jid: contact.jid,
    });
    void this.scrollAfterConversationLoad(contact.jid);
  }
  protected useJid(): void {
    if (this.search().includes('@')) {
      this.followLatest();
      const jid = this.search().trim();
      this.selectedContact.set(undefined);
      this.conversationSelection.set({ kind: 'direct', accountId: this.chat.accountId(), jid });
      void this.scrollAfterConversationLoad(jid);
    }
  }
  protected selectJoinedRoom(roomJid: string): void {
    if (!this.joinedRoom(roomJid)) return;
    this.muc.select(roomJid);
    this.selectedContact.set(undefined);
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
  protected async attach(): Promise<void> {
    await this.files.send(this.selectedJid());
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
    await this.muc.join(accountId, roomJid, nickname);
    if (this.joinedRoom(roomJid)?.accountId === accountId) this.selectJoinedRoom(roomJid);
  }
  protected async leaveRoom(): Promise<void> {
    const selection = this.activeSelection();
    if (selection.kind !== 'muc') return;
    await this.muc.leave(selection.accountId, selection.roomJid);
    if (!this.joinedRoom(selection.roomJid)) this.resetConversationSelection();
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
    this.conversationSelection.set({ kind: 'none', accountId: this.chat.accountId() });
    this.selectedContact.set(undefined);
    this.mucDraft.set('');
  }
}
