import { Injectable } from '@angular/core';
import { AppError, ConnectInput, ConnectionState, Contact, Message, MessageSendInput, Presence, PresenceInput, Result, TypedDomainEvent } from './domain';
import { createOpaqueId } from './ids';
import { XmppPort } from './ports';

@Injectable({ providedIn: 'root' })
export class InMemoryXmppPort implements XmppPort {
  private state: ConnectionState = { accountId: 'demo@example.invalid', status: 'idle', retryable: false, since: new Date().toISOString() };
  private readonly listeners = new Set<(event: TypedDomainEvent) => void>();
  async connect(input: ConnectInput): Promise<Result<ConnectionState>> { if (!input.accountId || !input.endpoint.host) return this.error('INVALID_INPUT', input.requestId, false, 'Cuenta o endpoint inválido.'); this.state = this.nextState(input.accountId, 'connected', false); this.emit({ version: 1, eventId: createOpaqueId('evt'), correlationId: input.requestId, type: 'connection.stateChanged', payload: this.state }); return this.ok(this.state, input.requestId); }
  async disconnect(accountId: string): Promise<Result<void>> { this.state = this.nextState(accountId, 'idle', false); this.emit({ version: 1, eventId: createOpaqueId('evt'), type: 'connection.stateChanged', payload: this.state }); return this.ok(undefined, createOpaqueId('req')); }
  async getState(accountId: string): Promise<Result<ConnectionState>> { return this.ok({ ...this.state, accountId }, createOpaqueId('req')); }
  async setPresence(input: PresenceInput): Promise<Result<Presence>> { if (this.state.status !== 'connected') return this.error('NOT_CONNECTED', input.requestId, true, 'La cuenta no está conectada.'); const presence: Presence = { jid: input.accountId, availability: input.availability, mode: input.mode, status: input.status, updatedAt: new Date().toISOString() }; this.emit({ version: 1, eventId: createOpaqueId('evt'), correlationId: input.requestId, type: 'presence.changed', payload: presence }); return this.ok(presence, input.requestId); }
  async listRoster(_accountId: string): Promise<Result<Contact[]>> { if (this.state.status !== 'connected') return this.error('NOT_CONNECTED', createOpaqueId('req'), true, 'La cuenta no está conectada.'); return this.ok([], createOpaqueId('req')); }
  async sendMessage(input: MessageSendInput): Promise<Result<Message>> { if (this.state.status !== 'connected') return this.error('NOT_CONNECTED', input.requestId, true, 'La cuenta no está conectada.'); const message: Message = { id: createOpaqueId('msg'), accountId: this.state.accountId, conversationId: input.conversationId, clientMessageId: input.clientMessageId, senderJid: this.state.accountId, body: input.body, status: 'sent', createdAt: new Date().toISOString() }; this.emit({ version: 1, eventId: createOpaqueId('evt'), correlationId: input.clientMessageId, type: 'message.stateChanged', payload: message }); return this.ok(message, input.requestId); }
  subscribe(listener: (event: TypedDomainEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private nextState(accountId: string, status: ConnectionState['status'], retryable: boolean): ConnectionState { return { accountId, status, retryable, since: new Date().toISOString() }; }
  private emit<TType extends TypedDomainEvent['type']>(event: Extract<TypedDomainEvent, { type: TType }>): void { this.listeners.forEach((listener) => listener(event)); }
  private ok<T>(value: T, requestId: string): Result<T> { return { ok: true, value, version: 1, requestId }; }
  private error<T>(code: AppError['code'], requestId: string, retryable: boolean, message: string): Result<T> { return { ok: false, version: 1, error: { code, retryable, requestId, message } }; }
}
