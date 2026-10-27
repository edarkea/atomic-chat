import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import { ConnectionState, Contact, Message, Presence, PresenceInput, Preferences } from './domain';
import { InMemoryXmppPort } from './in-memory-xmpp.port';
import { ElectronXmppPort } from './electron-xmpp.port';
import { XmppPort } from './ports';

@Injectable({ providedIn: 'root' })
export class ChatFacade {
  private readonly inMemory = inject(InMemoryXmppPort);
  private readonly electron = inject(ElectronXmppPort);
  private readonly xmpp: XmppPort = window.atomicChat ? this.electron : this.inMemory;
  readonly accountId = signal(window.atomicChat?.config.accountId || '');
  readonly connection = signal<ConnectionState>({ accountId: this.accountId(), status: 'idle', retryable: false, since: new Date().toISOString() });
  readonly contacts = signal<Contact[]>([]);
  readonly messages = signal<Message[]>([]);
  readonly presence = signal<Presence>({ jid: this.accountId(), availability: 'available', updatedAt: new Date().toISOString() });
  readonly isConnected = computed(() => this.connection().status === 'connected');
  readonly error = signal<string | null>(null);
  readonly preferences = signal<Preferences>({ theme: 'atomic', notifications: true, autoLogin: false });
  private identityGeneration = 0;
  private contactsOwner = '';
  private readonly accountContactReset = effect(() => { this.accountId(); this.contacts.set([]); });
  private isCurrent(generation: number, accountId: string): boolean { return generation === this.identityGeneration && accountId === this.accountId(); }
  private upsertMessage(message: Message, conversationId?: string): void {
    this.messages.update((items) => {
      const next = items.filter((item) => item.clientMessageId !== message.clientMessageId && item.id !== message.id);
      let low = 0;
      let high = next.length;
      while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (next[middle].createdAt.localeCompare(message.createdAt) <= 0) low = middle + 1;
        else high = middle;
      }
      next.splice(low, 0, message);
      return next;
    });
    if (conversationId) this.addConversation(message.accountId, conversationId);
  }
  private addConversation(accountId: string, jid: string): void { if (accountId !== this.accountId() || !jid) return; const bare = jid.split('/')[0].toLowerCase(); this.contacts.update((items) => items.some((item) => item.jid.split('/')[0].toLowerCase() === bare) ? items : [...items, { jid: bare, name: bare, groups: [], source: 'conversation' }]); }
  private mergeRoster(roster: Contact[]): void { const accountId = this.accountId(); if (this.contactsOwner !== accountId) { this.contacts.set([]); this.contactsOwner = accountId; } const previous = new Map(this.contacts().map((contact) => [contact.jid.split('/')[0].toLowerCase(), contact])); const normalized = new Map<string, Contact>(); for (const contact of roster) { const jid = contact.jid.split('/')[0].toLowerCase(); const authorized = contact.subscription === 'to' || contact.subscription === 'both'; const old = previous.get(jid); normalized.set(jid, { ...contact, jid, source: 'roster', ...(authorized && old?.presence ? { presence: old.presence } : {}) }); } this.contacts.update((items) => { const local = items.filter((item) => item.source === 'conversation' && !normalized.has(item.jid.split('/')[0].toLowerCase())); return [...normalized.values(), ...local]; }); }
  private async loadStoredConversations(accountId: string, generation: number): Promise<void> { if (!window.atomicChat?.history.conversations) return; try { const result = await window.atomicChat.history.conversations({ version: 1, requestId: createOpaqueId('req'), accountId }); if (!this.isCurrent(generation, accountId) || !result.ok) return; for (const conversation of result.value) this.addConversation(accountId, conversation.jid); } catch { /* History recovery is best effort; do not turn an authenticated session into a failed login. */ } }
  constructor() { this.xmpp.subscribe((event) => { if (event.type === 'connection.stateChanged') { const state = event.payload as ConnectionState; if (state.accountId === this.accountId()) this.connection.set(state); } if (event.type === 'presence.changed') { const presence = event.payload as Presence & { accountId?: string }; if (presence.accountId && presence.accountId !== this.accountId()) return; if (presence.jid === this.accountId()) this.presence.set(presence); else if (presence.accountId === this.accountId()) this.contacts.update((items) => items.map((contact) => contact.jid === presence.jid && contact.subscription && ['to', 'both'].includes(contact.subscription) ? { ...contact, presence } : contact)); } if (event.type === 'message.stateChanged' || event.type === 'message.received') { const message = event.payload as Message; if (message.accountId !== this.accountId()) return; this.upsertMessage(message, message.conversationId || message.senderJid); } }); }
  async tryAutoLogin(): Promise<void> { if (!window.atomicChat) return; const result = await window.atomicChat.preferences.get({ accountId: this.accountId() }); if (result.ok && result.value.autoLogin) await this.connect(this.accountId()); }
  async connect(accountId = this.accountId(), secret = ''): Promise<boolean> { const generation = ++this.identityGeneration; const requestedAccount = accountId.trim(); this.error.set(null); this.accountId.set(requestedAccount); try { const requestId = createOpaqueId('req'); const credentialRef = `account:${requestedAccount}`; if (window.atomicChat && secret) { const stored = await window.atomicChat.account.setSecret({ version: 1, requestId, credentialRef: credentialRef, secret }); if (!stored.ok) { if (this.isCurrent(generation, requestedAccount)) this.error.set(stored.error.message); return false; } } const endpoint = window.atomicChat?.config?.endpoint; if (!endpoint?.host || !endpoint.port) throw new Error('XMPP endpoint is not configured'); const result = await this.xmpp.connect({ version: 1, requestId, accountId: requestedAccount, endpoint, credentialRef: credentialRef }); if (!result.ok) { if (this.isCurrent(generation, requestedAccount)) this.error.set(result.error.message); return false; } if (!this.isCurrent(generation, requestedAccount)) return false; this.connection.set(result.value); const roster = await this.xmpp.listRoster(requestedAccount); if (roster.ok && this.isCurrent(generation, requestedAccount)) this.mergeRoster(roster.value); if (this.isCurrent(generation, requestedAccount)) await this.loadPreferences(generation, requestedAccount); return true; } catch { if (this.isCurrent(generation, requestedAccount)) this.error.set('No fue posible iniciar sesión con el servidor XMPP.'); return false; }
  }
  async disconnect(): Promise<void> { const result = await this.xmpp.disconnect(this.accountId()); if (result.ok) this.connection.set({ ...this.connection(), status: 'idle', since: new Date().toISOString() }); }
  async refreshState(): Promise<void> { const result = await this.xmpp.getState(this.accountId()); if (result.ok) this.connection.set(result.value); else this.error.set(result.error.message); }
  async refreshRoster(): Promise<void> { const accountId = this.accountId(); const generation = this.identityGeneration; const result = await this.xmpp.listRoster(accountId); if (result.ok && this.isCurrent(generation, accountId)) { this.mergeRoster(result.value); await this.loadStoredConversations(accountId, generation); } else if (!result.ok && this.isCurrent(generation, accountId)) this.error.set(result.error.message); }
  async loadConversation(conversationId: string): Promise<void> { if (!window.atomicChat || !conversationId) return; const accountId = this.accountId(); const generation = this.identityGeneration; const result = await window.atomicChat.history.list({ version: 1, requestId: createOpaqueId('req'), accountId, conversationId }); if (!this.isCurrent(generation, accountId)) return; if (result.ok) this.messages.update((items) => [...items.filter((item) => item.accountId !== accountId || item.conversationId !== conversationId), ...result.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt))); else this.error.set(result.error.message); }
  async loadPreferences(generation = this.identityGeneration, accountId = this.accountId()): Promise<void> { if (!window.atomicChat) return; await this.loadStoredConversations(accountId, generation); const result = await window.atomicChat.preferences.get({ accountId }); if (!this.isCurrent(generation, accountId)) return; if (result.ok) this.preferences.set(result.value); else this.error.set(result.error.message); }
  async updatePreferences(changes: Partial<Preferences>): Promise<void> { if (!window.atomicChat) return; const result = await window.atomicChat.preferences.update({ accountId: this.accountId(), changes }); if (result.ok) this.preferences.update((current) => ({ ...current, ...result.value })); else this.error.set(result.error.message); }
  async resetPreferences(): Promise<void> { if (!window.atomicChat) return; const result = await window.atomicChat.preferences.reset({ accountId: this.accountId() }); if (result.ok) this.preferences.set(result.value); else this.error.set(result.error.message); }
  async setPresence(mode: PresenceInput['mode'], status = ''): Promise<void> { const result = await this.xmpp.setPresence({ version: 1, requestId: createOpaqueId('req'), accountId: this.accountId(), availability: 'available', mode, status: status || undefined }); if (result.ok) this.presence.set(result.value); else this.error.set(result.error.message); }
  async setAvailability(availability: PresenceInput['availability']): Promise<void> { return this.setPresence(availability === 'unavailable' ? 'away' : undefined); }
  async send(text: string, conversationId: string): Promise<boolean> { const cleanText = text.trim(); const recipient = conversationId.trim(); if (!cleanText || !recipient || !this.accountId().trim()) return false; try { const result = await this.xmpp.sendMessage({ version: 1, requestId: createOpaqueId('req'), accountId: this.accountId(), conversationId: recipient, clientMessageId: createOpaqueId('client-msg'), body: { kind: 'text', text: cleanText } }); if (result.ok) { this.upsertMessage(result.value, recipient); return true; } this.error.set(result.error.message); return false; } catch { this.error.set('No fue posible enviar el mensaje.'); return false; } }
}
