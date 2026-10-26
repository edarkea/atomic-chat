import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { P0Facade } from './core/p0.facade';
import { Contact, Message } from './core/domain';

@Component({ selector: 'app-root', imports: [FormsModule], templateUrl: './app.html', styleUrl: './app.scss' })
export class App {
  protected readonly p0 = inject(P0Facade);
  protected readonly draft = signal('');
  protected readonly login = signal({ accountId: 'steeven.ayui', password: '' });
  protected readonly search = signal('');
  protected readonly selectedJid = signal('');
  protected readonly selectedContact = signal<Contact | undefined>(undefined);
  protected readonly settingsOpen = signal(false);
  constructor() { void this.p0.tryAutoLogin(); }
  protected filteredContacts(): Contact[] { const term = this.search().trim().toLowerCase(); return this.p0.contacts().filter((contact) => !term || contact.jid.toLowerCase().includes(term) || contact.name?.toLowerCase().includes(term)); }
  protected visibleMessages(): Message[] { const jid = this.selectedJid(); return this.p0.messages().filter((message) => !jid || message.conversationId === jid || message.senderJid === jid); }
  protected isOutgoing(message: Message): boolean { const sender = message.senderJid.split('/')[0].toLowerCase(); const account = this.p0.accountId().toLowerCase(); return sender === account || sender.startsWith(`${account}@`); }
  protected selectContact(contact: Contact): void { this.selectedContact.set(contact); this.selectedJid.set(contact.jid); void this.p0.loadConversation(contact.jid); }
  protected useJid(): void { if (this.search().includes('@')) { this.selectedContact.set(undefined); this.selectedJid.set(this.search().trim()); void this.p0.loadConversation(this.search().trim()); } }
  protected async connect(): Promise<void> { const connected = await this.p0.connect(this.login().accountId, this.login().password); if (connected) this.login.update((value) => ({ ...value, password: '' })); }
  protected async send(): Promise<void> { await this.p0.send(this.draft(), this.selectedJid()); this.draft.set(''); }
  protected toggleSettings(): void { this.settingsOpen.update((open) => !open); }
}
