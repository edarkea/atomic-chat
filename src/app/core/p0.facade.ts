import { Injectable, computed, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import { ConnectionState, Contact, Message, Presence, PresenceInput, Preferences } from './domain';
import { InMemoryXmppPort } from './in-memory-xmpp.port';
import { ElectronXmppPort } from './electron-xmpp.port';
import { XmppPort } from './ports';

@Injectable({ providedIn: 'root' })
export class P0Facade {
  private readonly inMemory = inject(InMemoryXmppPort);
  private readonly electron = inject(ElectronXmppPort);
  private readonly xmpp: XmppPort = window.atomicChat ? this.electron : this.inMemory;
  readonly accountId = signal('steeven.ayui');
  readonly connection = signal<ConnectionState>({ accountId: this.accountId(), status: 'idle', retryable: false, since: new Date().toISOString() });
  readonly contacts = signal<Contact[]>([]);
  readonly messages = signal<Message[]>([]);
  readonly presence = signal<Presence>({ jid: this.accountId(), availability: 'available', updatedAt: new Date().toISOString() });
  readonly isConnected = computed(() => this.connection().status === 'connected');
  readonly error = signal<string | null>(null);
  readonly preferences = signal<Preferences>({ theme: 'atomic', notifications: true, autoLogin: false });
  constructor() { this.xmpp.subscribe((event) => { if (event.type === 'connection.stateChanged') { const state = event.payload as ConnectionState; if (state.accountId === this.accountId()) this.connection.set(state); } if (event.type === 'presence.changed') { const presence = event.payload as Presence; if (presence.jid === this.accountId()) this.presence.set(presence); } if (event.type === 'message.stateChanged' || event.type === 'message.received') { const message = event.payload as Message; if (message.accountId !== this.accountId()) return; this.messages.update((items) => [...items.filter((item) => item.clientMessageId !== message.clientMessageId && item.id !== message.id), message].sort((a, b) => a.createdAt.localeCompare(b.createdAt))); } }); }
  async tryAutoLogin(): Promise<void> { if (!window.atomicChat) return; const result = await window.atomicChat.preferences.get({ accountId: this.accountId() }); if (result.ok && result.value.autoLogin) await this.connect(this.accountId()); }
  async connect(accountId = this.accountId(), secret = ''): Promise<boolean> { this.error.set(null); this.accountId.set(accountId.trim()); try { const requestId = createOpaqueId('req'); if (window.atomicChat && secret) { const stored = await window.atomicChat.account.setSecret({ version: 1, requestId, credentialRef: `account:${this.accountId()}`, secret }); if (!stored.ok) { this.error.set(stored.error.message); return false; } } const endpoint = window.atomicChat?.config?.endpoint; if (!endpoint?.host || !endpoint.port) throw new Error('XMPP endpoint is not configured'); const result = await this.xmpp.connect({ version: 1, requestId, accountId: this.accountId(), endpoint, credentialRef: `account:${this.accountId()}` }); if (!result.ok) { this.error.set(result.error.message); return false; } this.connection.set(result.value); const roster = await this.xmpp.listRoster(this.accountId()); if (roster.ok) this.contacts.set(roster.value); await this.loadPreferences(); return true; } catch { this.error.set('No fue posible iniciar sesión con el servidor XMPP.'); return false; }
  }
  async disconnect(): Promise<void> { const result = await this.xmpp.disconnect(this.accountId()); if (result.ok) this.connection.set({ ...this.connection(), status: 'idle', since: new Date().toISOString() }); }
  async refreshState(): Promise<void> { const result = await this.xmpp.getState(this.accountId()); if (result.ok) this.connection.set(result.value); else this.error.set(result.error.message); }
  async refreshRoster(): Promise<void> { const result = await this.xmpp.listRoster(this.accountId()); if (result.ok) this.contacts.set(result.value); else this.error.set(result.error.message); }
  async loadConversation(conversationId: string): Promise<void> { if (!window.atomicChat || !conversationId) return; const result = await window.atomicChat.history.list({ version: 1, requestId: createOpaqueId('req'), accountId: this.accountId(), conversationId }); if (result.ok) this.messages.update((items) => [...items.filter((item) => item.conversationId !== conversationId), ...result.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt))); else this.error.set(result.error.message); }
  async loadPreferences(): Promise<void> { if (!window.atomicChat) return; const result = await window.atomicChat.preferences.get({ accountId: this.accountId() }); if (result.ok) this.preferences.set(result.value); else this.error.set(result.error.message); }
  async updatePreferences(changes: Partial<Preferences>): Promise<void> { if (!window.atomicChat) return; const result = await window.atomicChat.preferences.update({ accountId: this.accountId(), changes }); if (result.ok) this.preferences.update((current) => ({ ...current, ...result.value })); else this.error.set(result.error.message); }
  async resetPreferences(): Promise<void> { if (!window.atomicChat) return; const result = await window.atomicChat.preferences.reset({ accountId: this.accountId() }); if (result.ok) this.preferences.set(result.value); else this.error.set(result.error.message); }
  async setAvailability(availability: PresenceInput['availability']): Promise<void> { const result = await this.xmpp.setPresence({ version: 1, requestId: createOpaqueId('req'), accountId: this.accountId(), availability }); if (result.ok) this.presence.set(result.value); else this.error.set(result.error.message); }
  async send(text: string, conversationId: string): Promise<boolean> { const cleanText = text.trim(); const recipient = conversationId.trim(); if (!cleanText || !recipient || !this.accountId().trim()) return false; try { const result = await this.xmpp.sendMessage({ version: 1, requestId: createOpaqueId('req'), accountId: this.accountId(), conversationId: recipient, clientMessageId: createOpaqueId('client-msg'), body: { kind: 'text', text: cleanText } }); if (result.ok) { this.messages.update((items) => [...items.filter((item) => item.clientMessageId !== result.value.clientMessageId), result.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt))); return true; } this.error.set(result.error.message); return false; } catch { this.error.set('No fue posible enviar el mensaje.'); return false; } }
}
