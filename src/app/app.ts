import { Component, computed, DestroyRef, ElementRef, effect, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatFacade } from './core/chat.facade';
import { MucFacade } from './core/muc.facade';
import { FileFacade } from './core/file.facade';
import { CertificateTrustDecision, Contact, FileTransfer, Message, RoomMessage, RoomState } from './core/domain';

type ConversationSelection =
  | { kind: 'none'; accountId: string }
  | { kind: 'direct'; accountId: string; jid: string }
  | { kind: 'muc'; accountId: string; roomJid: string };
type ConversationTimelineItem =
  | { kind: 'text'; id: string; sortAt: string; message: Message }
  | { kind: 'incoming-file'; id: string; sortAt: string; transfer: FileTransfer };

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrls: ['./app.scss', './certificate-dialog.scss', './file-transfer.scss'] })
export class App {
  protected readonly chat = inject(ChatFacade);
  protected readonly muc = inject(MucFacade);
  protected readonly files = inject(FileFacade);
  protected readonly draft = signal('');
  protected readonly login = signal({ accountId: '', password: '' });
  protected readonly search = signal('');
  protected readonly conversationSelection = signal<ConversationSelection>({ kind: 'none', accountId: '' });
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
    if (!accountId || !this.chat.isConnected() || selection.accountId !== accountId) return { kind: 'none', accountId };
    if (selection.kind === 'muc' && !this.joinedRoom(selection.roomJid)) return { kind: 'none', accountId };
    return selection;
  });
  protected readonly selectedJid = computed(() => {
    const selection = this.activeSelection();
    return selection.kind === 'direct' ? selection.jid : '';
  });
  protected readonly joinedRooms = computed(() => this.muc.states().filter((state) => state.accountId === this.chat.accountId() && state.status === 'joined'));
  protected readonly activeRoomState = computed(() => {
    const selection = this.activeSelection();
    return selection.kind === 'muc' ? this.joinedRoom(selection.roomJid) : undefined;
  });
  protected readonly filteredContacts = computed(() => { const term = this.search().trim().toLowerCase(); return this.chat.contacts().filter((contact) => !term || contact.jid.toLowerCase().includes(term) || contact.name?.toLowerCase().includes(term)); });
  protected readonly visibleMessages = computed(() => { const jid = this.bareJid(this.selectedJid()); if (!jid) return []; const accountId = this.chat.accountId(); return this.chat.messages().filter((message) => message.accountId === accountId && (this.bareJid(message.conversationId) === jid || this.bareJid(message.senderJid) === jid)); });
  protected readonly conversationTimeline = computed<ReadonlyArray<ConversationTimelineItem>>(() => {
    const messages: ConversationTimelineItem[] = this.visibleMessages().map((message) => ({ kind: 'text', id: `text:${message.clientMessageId || message.id}`, sortAt: message.createdAt, message }));
    const files: ConversationTimelineItem[] = this.files.forConversation(this.chat.accountId(), this.selectedJid()).map((transfer) => ({ kind: 'incoming-file', id: `file:${transfer.offer.transferId}`, sortAt: transfer.offer.offeredAt, transfer }));
    return [...messages, ...files].sort((left, right) => left.sortAt.localeCompare(right.sortAt) || left.id.localeCompare(right.id));
  });
  protected readonly activeContact = computed(() => { const jid = this.bareJid(this.selectedJid()); return this.chat.contacts().find((contact) => this.bareJid(contact.jid) === jid); });
  protected readonly presenceOptions = [
    { id: 'chat', mode: 'chat' as const, label: 'Libre para chatear', dot: 'chat' },
    { id: 'online', mode: undefined, label: 'En línea', dot: 'online' },
    { id: 'away', mode: 'away' as const, label: 'Ausente', dot: 'away' },
    { id: 'phone', mode: 'away' as const, label: 'Al teléfono', dot: 'phone' },
    { id: 'xa', mode: 'xa' as const, label: 'Ausencia extendida', dot: 'xa' },
    { id: 'dnd', mode: 'dnd' as const, label: 'No molestar', dot: 'dnd' },
  ];
  @ViewChild('chatContent') private chatContent?: ElementRef<HTMLElement>;
  @ViewChild('certificateDialog') private certificateDialog?: ElementRef<HTMLElement>;
  private followLatest = true;
  private renderedConversation = '';
  private frame: number | undefined;
  private scrollGeneration = 0;
  private certificateWasOpen = false;
  private certificateReturnFocus?: HTMLElement;
  private readonly destroyRef = inject(DestroyRef);
  private readonly visibleMessageKey = computed(() => { const items = this.conversationTimeline(); const last = items[items.length - 1]; return `${this.bareJid(this.selectedJid())}|${items.length}|${last?.id || ''}|${last?.sortAt || ''}`; });
  constructor() { void this.chat.tryAutoLogin(); effect(() => { const account = this.chat.accountId(); if (this.chat.isConnected() && account) void this.files.setAccount(account); }); effect(() => { this.visibleMessageKey(); const conversation = this.bareJid(this.selectedJid()); if (conversation) this.scheduleScroll(conversation, conversation !== this.renderedConversation); }); effect(() => { const request = this.certificateRequest(); if (request && !this.certificateWasOpen) { this.certificateWasOpen = true; const active = document.activeElement; this.certificateReturnFocus = active instanceof HTMLElement ? active : undefined; queueMicrotask(() => { const dialog = this.certificateDialog?.nativeElement; dialog?.focus(); dialog?.querySelector<HTMLElement>('button:not([disabled])')?.focus(); }); } else if (!request && this.certificateWasOpen) { this.certificateWasOpen = false; const returnFocus = this.certificateReturnFocus; this.certificateReturnFocus = undefined; queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus(); }); } }); this.destroyRef.onDestroy(() => { if (this.frame !== undefined) cancelAnimationFrame(this.frame); }); }
  protected contactName(contact: Contact): string { return contact.name?.trim() || contact.jid; }
  protected contactGroups(contact: Contact): string[] { return [...new Set((contact.groups || []).map((group) => group.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
  protected contactKind(contact: Contact): string { return contact.source === 'conversation' ? 'Conversación local' : this.contactGroups(contact).length ? this.contactGroups(contact).join(' · ') : 'Sin grupo'; }
  protected remotePresenceLabel(contact: Contact | undefined): string { const presence = contact?.presence; if (!presence) return 'Estado desconocido'; if (presence.availability === 'unavailable') return 'No disponible'; return ({ chat: 'Libre para chatear', away: 'Ausente', xa: 'Ausencia extendida', dnd: 'No molestar' } as Record<string, string>)[presence.mode || ''] || 'En línea'; }
  protected remotePresenceDot(contact: Contact | undefined): string { const presence = contact?.presence; if (!presence || presence.availability === 'unavailable') return 'unknown'; return presence.mode || 'online'; }
  protected isMucMessageOutgoing(message: RoomMessage, roomState: RoomState): boolean { return message.accountId === roomState.accountId && message.roomJid === roomState.room.jid && message.occupantJid === roomState.selfOccupantJid; }
  protected mucSenderLabel(message: RoomMessage, roomState: RoomState): string { const nickname = this.occupantNickname(message.occupantJid) || 'Participante desconocido'; return this.isMucMessageOutgoing(message, roomState) ? `Tú · ${nickname}` : nickname; }
  protected directSenderLabel(message: Message): string { if (message.accountId !== this.chat.accountId()) return 'Remitente desconocido'; if (this.isOutgoing(message)) return 'Tú'; const senderJid = this.bareJid(message.senderJid); if (!senderJid) return 'Remitente desconocido'; const contact = this.chat.contacts().find((item) => this.bareJid(item.jid) === senderJid); return contact?.name?.trim() || senderJid; }
  private bareJid(jid: string): string { return jid.split('/')[0].toLowerCase(); }
  private occupantNickname(occupantJid: string): string { const separator = occupantJid.indexOf('/'); return separator >= 0 ? occupantJid.slice(separator + 1).trim() : ''; }
  private scheduleScroll(conversation: string, force: boolean): void { const generation = ++this.scrollGeneration; if (this.frame !== undefined) cancelAnimationFrame(this.frame); if (!force && !this.followLatest) return; this.frame = requestAnimationFrame(() => { this.frame = undefined; if (generation !== this.scrollGeneration || this.bareJid(this.selectedJid()) !== conversation) return; const element = this.chatContent?.nativeElement; if (!element) return; element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight); this.renderedConversation = conversation; }); }
  private async scrollAfterConversationLoad(jid: string): Promise<void> { await this.chat.loadConversation(jid); if (this.bareJid(this.selectedJid()) !== this.bareJid(jid)) return; this.scheduleScroll(this.bareJid(jid), true); }
  protected onUserScrollIntent(): void { queueMicrotask(() => { const element = this.chatContent?.nativeElement; if (element) this.followLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }); }
  protected onChatScroll(): void { const element = this.chatContent?.nativeElement; const conversation = this.bareJid(this.selectedJid()); const accountId = this.chat.accountId(); if (!element || !conversation || this.chat.historyLoading()) return; this.followLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 48; if (element.scrollTop < 48 && this.chat.hasOlderMessages()) { const previousHeight = element.scrollHeight; void this.chat.loadOlderMessages(conversation).then(() => requestAnimationFrame(() => { const current = this.chatContent?.nativeElement; if (current && this.chat.accountId() === accountId && this.bareJid(this.selectedJid()) === conversation) current.scrollTop += current.scrollHeight - previousHeight; })); } else if (this.followLatest && this.chat.hasNewerMessages()) void this.chat.loadNewerMessages(conversation); }
  private selectedPresenceOption() { const current = this.chat.presence(); return this.presenceOptions.find((option) => option.mode === current.mode && (option.id !== 'phone' || current.status === 'Al teléfono') && (option.id !== 'away' || current.status !== 'Al teléfono')) || this.presenceOptions[1]; }
  protected presenceLabel(): string { return this.selectedPresenceOption().label; }
  protected presenceDot(): string { return this.selectedPresenceOption().dot; }
  protected isPresenceSelected(id: string): boolean { return this.selectedPresenceOption().id === id; }
  protected connectionLabel(): string { const labels: Record<string, string> = { idle: 'Desconectado', connecting: 'Conectando', authenticating: 'Autenticando', connected: 'Conectado', disconnecting: 'Desconectando', failed: 'Falló' }; return labels[this.chat.connection().status] || this.chat.connection().status; }
  protected togglePresence(): void { this.presenceOpen.update((open) => !open); }
  protected async choosePresence(option: { id: string; mode: 'chat' | 'away' | 'dnd' | 'xa' | undefined; label: string }): Promise<void> { const status = option.id === 'phone' ? 'Al teléfono' : option.id === 'away' ? '' : this.presenceStatus(); await this.chat.setPresence(option.mode, status); this.presenceOpen.set(false); }
  protected isOutgoing(message: Message): boolean { const sender = message.senderJid.split('/')[0].toLowerCase(); const account = this.chat.accountId().toLowerCase(); return sender === account || sender.startsWith(`${account}@`); }
  protected selectContact(contact: Contact): void { this.followLatest = true; this.selectedContact.set(contact); this.conversationSelection.set({ kind: 'direct', accountId: this.chat.accountId(), jid: contact.jid }); void this.scrollAfterConversationLoad(contact.jid); }
  protected useJid(): void { if (this.search().includes('@')) { this.followLatest = true; const jid = this.search().trim(); this.selectedContact.set(undefined); this.conversationSelection.set({ kind: 'direct', accountId: this.chat.accountId(), jid }); void this.scrollAfterConversationLoad(jid); } }
  protected selectJoinedRoom(roomJid: string): void { if (!this.joinedRoom(roomJid)) return; this.muc.select(roomJid); this.selectedContact.set(undefined); this.conversationSelection.set({ kind: 'muc', accountId: this.chat.accountId(), roomJid }); this.followLatest = true; }
  protected selectRoomFromCatalog(roomJid: string): void { const room = this.joinedRoom(roomJid); if (room) { this.selectJoinedRoom(roomJid); return; } if (this.activeSelection().kind !== 'muc') this.muc.select(roomJid); }
  protected isDirectSelected(jid: string): boolean { const selection = this.activeSelection(); return selection.kind === 'direct' && this.bareJid(selection.jid) === this.bareJid(jid); }
  protected isMucSelected(roomJid: string): boolean { const selection = this.activeSelection(); return selection.kind === 'muc' && selection.roomJid === roomJid; }
  protected async connect(): Promise<void> { this.resetConversationSelection(); this.muc.setAccount(this.login().accountId.trim()); const connected = await this.chat.connect(this.login().accountId, this.login().password); if (connected) { this.login.update((value) => ({ ...value, password: '' })); await this.files.setAccount(this.chat.accountId()); } }
  protected async disconnect(): Promise<void> { this.resetConversationSelection(); await this.chat.disconnect(); await this.files.setAccount(''); }
  protected async decideCertificate(decision: CertificateTrustDecision): Promise<void> { await this.chat.decideCertificate(decision); }
  protected onCertificateDialogKeydown(event: KeyboardEvent): void { const dialog = this.certificateDialog?.nativeElement; if (!dialog) return; if (event.key === 'Escape') { event.preventDefault(); void this.decideCertificate('cancel'); return; } if (event.key !== 'Tab') return; const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0); if (!focusable.length) { event.preventDefault(); dialog.focus(); return; } const first = focusable[0]; const last = focusable[focusable.length - 1]; if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  protected async send(): Promise<void> { const sentDraft = this.draft(); try { const accepted = await this.chat.send(sentDraft, this.selectedJid()); if (accepted && this.draft() === sentDraft) this.draft.set(''); } catch { this.chat.error.set('No fue posible enviar el mensaje.'); } }
  protected async discoverRooms(): Promise<void> { this.mucDiscovering.set(true); try { await this.muc.discover(this.chat.accountId()); } finally { this.mucDiscovering.set(false); } }
  protected async joinRoom(roomJid: string): Promise<void> { const accountId = this.chat.accountId(); const nickname = this.mucNickname().trim() || accountId.split('@')[0] || 'operator'; await this.muc.join(accountId, roomJid, nickname); if (this.joinedRoom(roomJid)?.accountId === accountId) this.selectJoinedRoom(roomJid); }
  protected async leaveRoom(): Promise<void> { const selection = this.activeSelection(); if (selection.kind !== 'muc') return; await this.muc.leave(selection.accountId, selection.roomJid); if (!this.joinedRoom(selection.roomJid)) this.resetConversationSelection(); }
  protected async sendRoom(): Promise<void> { const selection = this.activeSelection(); const sent = this.mucDraft(); if (selection.kind === 'muc' && await this.muc.send(selection.accountId, selection.roomJid, sent) && this.mucDraft() === sent) this.mucDraft.set(''); }
  protected roomStatus(roomJid: string): string { return this.muc.states().find((state) => state.room.jid === roomJid)?.status || 'idle'; }
  protected toggleSettings(): void { this.settingsOpen.update((open) => !open); }
  private joinedRoom(roomJid: string): RoomState | undefined { return this.muc.states().find((state) => state.room.jid === roomJid && state.accountId === this.chat.accountId() && state.status === 'joined'); }
  private resetConversationSelection(): void { this.conversationSelection.set({ kind: 'none', accountId: this.chat.accountId() }); this.selectedContact.set(undefined); this.mucDraft.set(''); }
}
