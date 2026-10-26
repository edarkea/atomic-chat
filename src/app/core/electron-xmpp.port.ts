import { Injectable } from '@angular/core';
import { ConnectInput, ConnectionState, Contact, DomainEvent, Message, MessageSendInput, Presence, PresenceInput, Result } from './domain';
import { XmppPort } from './ports';
import './electron-api';

@Injectable({ providedIn: 'root' })
export class ElectronXmppPort implements XmppPort {
  async connect(input: ConnectInput): Promise<Result<ConnectionState>> { return this.api().account.connect(input); }
  async disconnect(accountId: string): Promise<Result<void>> { return this.api().account.disconnect(accountId); }
  async getState(accountId: string): Promise<Result<ConnectionState>> { return this.api().session.getState(accountId); }
  async setPresence(input: PresenceInput): Promise<Result<Presence>> { return this.api().presence.set(input); }
  async listRoster(accountId: string): Promise<Result<Contact[]>> { return this.api().roster.list(accountId); }
  async sendMessage(input: MessageSendInput): Promise<Result<Message>> { return this.api().messaging.send(input); }
  subscribe(listener: (event: DomainEvent<unknown>) => void): () => void { return this.api().subscribe(listener); }
  private api() { if (!window.atomicChat) throw new Error('electron_api_unavailable'); return window.atomicChat; }
}
