import { Component, computed, DestroyRef, ElementRef, effect, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { P0Facade } from './core/p0.facade';
import { Contact, Message } from './core/domain';

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.scss' })
export class App {
  protected readonly p0 = inject(P0Facade);
  protected readonly draft = signal('');
  protected readonly login = signal({ accountId: '', password: '' });
  protected readonly search = signal('');
  protected readonly selectedJid = signal('');
  protected readonly selectedContact = signal<Contact | undefined>(undefined);
  protected readonly settingsOpen = signal(false);
  @ViewChild('chatContent') private chatContent?: ElementRef<HTMLElement>;
  private followLatest = true;
  private renderedConversation = '';
  private frame: number | undefined;
  private scrollGeneration = 0;
  private readonly destroyRef = inject(DestroyRef);
  private readonly visibleMessageKey = computed(() => { const messages = this.visibleMessages(); const last = messages[messages.length - 1]; return `${this.bareJid(this.selectedJid())}|${messages.length}|${last?.id || ''}|${last?.clientMessageId || ''}|${last?.body.text || ''}`; });
  constructor() { void this.p0.tryAutoLogin(); effect(() => { this.visibleMessageKey(); const conversation = this.bareJid(this.selectedJid()); if (conversation) this.scheduleScroll(conversation, conversation !== this.renderedConversation); }); this.destroyRef.onDestroy(() => { if (this.frame !== undefined) cancelAnimationFrame(this.frame); }); }
  protected filteredContacts(): Contact[] { const term = this.search().trim().toLowerCase(); return this.p0.contacts().filter((contact) => !term || contact.jid.toLowerCase().includes(term) || contact.name?.toLowerCase().includes(term)); }
  protected visibleMessages(): Message[] { const jid = this.bareJid(this.selectedJid()); if (!jid) return []; const accountId = this.p0.accountId(); return this.p0.messages().filter((message) => message.accountId === accountId && (this.bareJid(message.conversationId) === jid || this.bareJid(message.senderJid) === jid)); }
  private bareJid(jid: string): string { return jid.split('/')[0].toLowerCase(); }
  private scheduleScroll(conversation: string, force: boolean): void { const generation = ++this.scrollGeneration; if (this.frame !== undefined) cancelAnimationFrame(this.frame); if (!force && !this.followLatest) return; this.frame = requestAnimationFrame(() => { this.frame = undefined; if (generation !== this.scrollGeneration || this.bareJid(this.selectedJid()) !== conversation) return; const element = this.chatContent?.nativeElement; if (!element) return; element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight); this.renderedConversation = conversation; }); }
  private async scrollAfterConversationLoad(jid: string): Promise<void> { await this.p0.loadConversation(jid); if (this.bareJid(this.selectedJid()) !== this.bareJid(jid)) return; this.scheduleScroll(this.bareJid(jid), true); }
  protected onUserScrollIntent(): void { queueMicrotask(() => { const element = this.chatContent?.nativeElement; if (element) this.followLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }); }
  protected isOutgoing(message: Message): boolean { const sender = message.senderJid.split('/')[0].toLowerCase(); const account = this.p0.accountId().toLowerCase(); return sender === account || sender.startsWith(`${account}@`); }
  protected selectContact(contact: Contact): void { this.followLatest = true; this.selectedContact.set(contact); this.selectedJid.set(contact.jid); void this.scrollAfterConversationLoad(contact.jid); }
  protected useJid(): void { if (this.search().includes('@')) { this.followLatest = true; this.selectedContact.set(undefined); this.selectedJid.set(this.search().trim()); void this.scrollAfterConversationLoad(this.search().trim()); } }
  protected async connect(): Promise<void> { const connected = await this.p0.connect(this.login().accountId, this.login().password); if (connected) this.login.update((value) => ({ ...value, password: '' })); }
  protected async send(): Promise<void> { const sentDraft = this.draft(); try { const accepted = await this.p0.send(sentDraft, this.selectedJid()); if (accepted && this.draft() === sentDraft) this.draft.set(''); } catch { this.p0.error.set('No fue posible enviar el mensaje.'); } }
  protected toggleSettings(): void { this.settingsOpen.update((open) => !open); }
}
