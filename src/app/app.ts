import { Component, computed, DestroyRef, ElementRef, effect, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatFacade } from './core/chat.facade';
import { MucFacade } from './core/muc.facade';
import { CertificateTrustDecision, Contact, Message } from './core/domain';

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrls: ['./app.scss', './certificate-dialog.scss'] })
export class App {
  protected readonly chat = inject(ChatFacade);
  protected readonly muc = inject(MucFacade);
  protected readonly draft = signal('');
  protected readonly login = signal({ accountId: '', password: '' });
  protected readonly search = signal('');
  protected readonly selectedJid = signal('');
  protected readonly selectedContact = signal<Contact | undefined>(undefined);
  protected readonly settingsOpen = signal(false);
  protected readonly certificateRequest = computed(() => this.chat.certificateRequest?.() ?? null);
  protected readonly presenceOpen = signal(false);
  protected readonly presenceStatus = signal('');
  protected readonly mucNickname = signal('');
  protected readonly mucDraft = signal('');
  protected readonly mucDiscovering = signal(false);
  protected readonly filteredContacts = computed(() => { const term = this.search().trim().toLowerCase(); return this.chat.contacts().filter((contact) => !term || contact.jid.toLowerCase().includes(term) || contact.name?.toLowerCase().includes(term)); });
  protected readonly visibleMessages = computed(() => { const jid = this.bareJid(this.selectedJid()); if (!jid) return []; const accountId = this.chat.accountId(); return this.chat.messages().filter((message) => message.accountId === accountId && (this.bareJid(message.conversationId) === jid || this.bareJid(message.senderJid) === jid)); });
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
  private readonly visibleMessageKey = computed(() => { const messages = this.visibleMessages(); const last = messages[messages.length - 1]; return `${this.bareJid(this.selectedJid())}|${messages.length}|${last?.id || ''}|${last?.clientMessageId || ''}|${last?.body.text || ''}`; });
  constructor() { void this.chat.tryAutoLogin(); effect(() => { this.visibleMessageKey(); const conversation = this.bareJid(this.selectedJid()); if (conversation) this.scheduleScroll(conversation, conversation !== this.renderedConversation); }); effect(() => { const request = this.certificateRequest(); if (request && !this.certificateWasOpen) { this.certificateWasOpen = true; const active = document.activeElement; this.certificateReturnFocus = active instanceof HTMLElement ? active : undefined; queueMicrotask(() => { const dialog = this.certificateDialog?.nativeElement; dialog?.focus(); dialog?.querySelector<HTMLElement>('button:not([disabled])')?.focus(); }); } else if (!request && this.certificateWasOpen) { this.certificateWasOpen = false; const returnFocus = this.certificateReturnFocus; this.certificateReturnFocus = undefined; queueMicrotask(() => { if (returnFocus?.isConnected) returnFocus.focus(); }); } }); this.destroyRef.onDestroy(() => { if (this.frame !== undefined) cancelAnimationFrame(this.frame); }); }
  protected contactName(contact: Contact): string { return contact.name?.trim() || contact.jid; }
  protected contactGroups(contact: Contact): string[] { return [...new Set((contact.groups || []).map((group) => group.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
  protected contactKind(contact: Contact): string { return contact.source === 'conversation' ? 'Conversación local' : this.contactGroups(contact).length ? this.contactGroups(contact).join(' · ') : 'Sin grupo'; }
  protected remotePresenceLabel(contact: Contact | undefined): string { const presence = contact?.presence; if (!presence) return 'Estado desconocido'; if (presence.availability === 'unavailable') return 'No disponible'; return ({ chat: 'Libre para chatear', away: 'Ausente', xa: 'Ausencia extendida', dnd: 'No molestar' } as Record<string, string>)[presence.mode || ''] || 'En línea'; }
  protected remotePresenceDot(contact: Contact | undefined): string { const presence = contact?.presence; if (!presence || presence.availability === 'unavailable') return 'unknown'; return presence.mode || 'online'; }
  private bareJid(jid: string): string { return jid.split('/')[0].toLowerCase(); }
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
  protected selectContact(contact: Contact): void { this.followLatest = true; this.selectedContact.set(contact); this.selectedJid.set(contact.jid); void this.scrollAfterConversationLoad(contact.jid); }
  protected useJid(): void { if (this.search().includes('@')) { this.followLatest = true; this.selectedContact.set(undefined); this.selectedJid.set(this.search().trim()); void this.scrollAfterConversationLoad(this.search().trim()); } }
  protected async connect(): Promise<void> { this.muc.setAccount(this.login().accountId.trim()); const connected = await this.chat.connect(this.login().accountId, this.login().password); if (connected) this.login.update((value) => ({ ...value, password: '' })); }
  protected async decideCertificate(decision: CertificateTrustDecision): Promise<void> { await this.chat.decideCertificate(decision); }
  protected onCertificateDialogKeydown(event: KeyboardEvent): void { const dialog = this.certificateDialog?.nativeElement; if (!dialog) return; if (event.key === 'Escape') { event.preventDefault(); void this.decideCertificate('cancel'); return; } if (event.key !== 'Tab') return; const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0); if (!focusable.length) { event.preventDefault(); dialog.focus(); return; } const first = focusable[0]; const last = focusable[focusable.length - 1]; if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  protected async send(): Promise<void> { const sentDraft = this.draft(); try { const accepted = await this.chat.send(sentDraft, this.selectedJid()); if (accepted && this.draft() === sentDraft) this.draft.set(''); } catch { this.chat.error.set('No fue posible enviar el mensaje.'); } }
  protected async discoverRooms(): Promise<void> { this.mucDiscovering.set(true); try { await this.muc.discover(this.chat.accountId()); } finally { this.mucDiscovering.set(false); } }
  protected async joinRoom(roomJid: string): Promise<void> { const nickname = this.mucNickname().trim() || this.chat.accountId().split('@')[0] || 'operator'; await this.muc.join(this.chat.accountId(), roomJid, nickname); }
  protected async leaveRoom(): Promise<void> { const roomJid = this.muc.selectedRoomJid(); if (roomJid) await this.muc.leave(this.chat.accountId(), roomJid); }
  protected async sendRoom(): Promise<void> { const roomJid = this.muc.selectedRoomJid(); const sent = this.mucDraft(); if (roomJid && await this.muc.send(this.chat.accountId(), roomJid, sent) && this.mucDraft() === sent) this.mucDraft.set(''); }
  protected roomStatus(roomJid: string): string { return this.muc.states().find((state) => state.room.jid === roomJid)?.status || 'idle'; }
  protected toggleSettings(): void { this.settingsOpen.update((open) => !open); }
}
