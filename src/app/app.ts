import { AfterViewChecked, Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { P0Facade } from './core/p0.facade';
import { Contact, Message } from './core/domain';

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.scss' })
export class App implements AfterViewChecked {
  protected readonly p0 = inject(P0Facade);
  protected readonly draft = signal('');
  protected readonly login = signal({ accountId: '', password: '' });
  protected readonly search = signal('');
  protected readonly selectedJid = signal('');
  protected readonly selectedContact = signal<Contact | undefined>(undefined);
  protected readonly settingsOpen = signal(false);
  @ViewChild('chatContent') private chatContent?: ElementRef<HTMLElement>;
  private scrollPending = true;
  private renderedMessageCount = -1;
  private renderedConversation = '';
  constructor() { void this.p0.tryAutoLogin(); }
  protected filteredContacts(): Contact[] { const term = this.search().trim().toLowerCase(); return this.p0.contacts().filter((contact) => !term || contact.jid.toLowerCase().includes(term) || contact.name?.toLowerCase().includes(term)); }
  protected visibleMessages(): Message[] { const jid = this.bareJid(this.selectedJid()); if (!jid) return []; const accountId = this.p0.accountId(); return this.p0.messages().filter((message) => message.accountId === accountId && (this.bareJid(message.conversationId) === jid || this.bareJid(message.senderJid) === jid)); }
  private bareJid(jid: string): string { return jid.split('/')[0].toLowerCase(); }
  ngAfterViewChecked(): void { const count = this.visibleMessages().length; const conversation = this.bareJid(this.selectedJid()); if (this.scrollPending && (count !== this.renderedMessageCount || conversation !== this.renderedConversation) && this.chatContent) { const element = this.chatContent.nativeElement; element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight); this.renderedMessageCount = count; this.renderedConversation = conversation; if (count > 0) this.scrollPending = false; } }
  protected onChatScroll(): void { const element = this.chatContent?.nativeElement; if (element) this.scrollPending = element.scrollHeight - element.scrollTop - element.clientHeight < 48; }
  protected isOutgoing(message: Message): boolean { const sender = message.senderJid.split('/')[0].toLowerCase(); const account = this.p0.accountId().toLowerCase(); return sender === account || sender.startsWith(`${account}@`); }
  protected selectContact(contact: Contact): void { this.scrollPending = true; this.selectedContact.set(contact); this.selectedJid.set(contact.jid); void this.p0.loadConversation(contact.jid); }
  protected useJid(): void { if (this.search().includes('@')) { this.scrollPending = true; this.selectedContact.set(undefined); this.selectedJid.set(this.search().trim()); void this.p0.loadConversation(this.search().trim()); } }
  protected async connect(): Promise<void> { const connected = await this.p0.connect(this.login().accountId, this.login().password); if (connected) this.login.update((value) => ({ ...value, password: '' })); }
  protected async send(): Promise<void> { const sentDraft = this.draft(); try { const accepted = await this.p0.send(sentDraft, this.selectedJid()); if (accepted && this.draft() === sentDraft) this.draft.set(''); } catch { this.p0.error.set('No fue posible enviar el mensaje.'); } }
  protected toggleSettings(): void { this.settingsOpen.update((open) => !open); }
}
