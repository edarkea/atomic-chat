import { Injectable } from '@angular/core';
import { ConnectInput, ConnectionState, Contact, Message, MessageSendInput, MucDiscoverInput, MucJoinInput, MucLeaveInput, MucSendInput, Presence, PresenceInput, Result, RoomRef, RoomSendReceipt, RoomState, TypedDomainEvent } from './domain';
import { subscribeToDomainEvents } from './domain-event.validation';
import { getAtomicChatApi } from './electron-api';
import { MucPort, XmppPort } from './ports';

@Injectable({ providedIn: 'root' })
export class ElectronXmppPort implements XmppPort, MucPort {
  async connect(input: ConnectInput): Promise<Result<ConnectionState>> { return this.api().account.connect(input); }
  async disconnect(accountId: string): Promise<Result<void>> { return this.api().account.disconnect(accountId); }
  async getState(accountId: string): Promise<Result<ConnectionState>> { return this.api().session.getState(accountId); }
  async setPresence(input: PresenceInput): Promise<Result<Presence>> { return this.api().presence.set(input); }
  async listRoster(accountId: string): Promise<Result<Contact[]>> { return this.api().roster.list(accountId); }
  async sendMessage(input: MessageSendInput): Promise<Result<Message>> { return this.api().messaging.send(input); }
  async discover(input: MucDiscoverInput): Promise<Result<ReadonlyArray<RoomRef>>> { return this.api().muc.discover(input); }
  async join(input: MucJoinInput): Promise<Result<RoomState>> { return this.api().muc.join(input); }
  async leave(input: MucLeaveInput): Promise<Result<RoomState>> { return this.api().muc.leave(input); }
  async sendRoomMessage(input: MucSendInput): Promise<Result<RoomSendReceipt>> { return this.api().muc.sendMessage(input); }
  subscribe(listener: (event: TypedDomainEvent) => void): () => void { return subscribeToDomainEvents((handler) => this.api().subscribe(handler), listener); }
  private api() { const api = getAtomicChatApi(); if (!api) throw new Error('electron_api_unavailable'); return api; }
}
