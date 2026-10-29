import { Injectable } from '@angular/core';
import { AppError, ConnectInput, ConnectionState, Contact, DomainEvent, Message, MessageSendInput, Presence, PresenceInput, Result } from './domain';
import { createOpaqueId } from './ids';
import { XmppPort } from './ports';

@Injectable({ providedIn: 'root' })
export class InMemoryXmppPort implements XmppPort {
  private state: ConnectionState = { accountId: 'demo@example.invalid', status: 'idle', retryable: false, since: new Date().toISOString() };
  private readonly listeners = new Set<(event: DomainEvent<unknown>) => void>();
  async connect(input: ConnectInput): Promise<Result<ConnectionState>> { if (!input.accountId || !input.endpoint.host) return this.error('INVALID_INPUT', input.requestId, false, 'Cuenta o endpoint inválido.'); this.state = this.nextState(input.accountId, 'connected', false); this.emit('connection.stateChanged', input.requestId, this.state); return this.ok(this.state, input.requestId); }
  async disconnect(accountId: string): Promise<Result<void>> { this.state = this.nextState(accountId, 'idle', false); this.emit('connection.stateChanged', createOpaqueId('req'), this.state); return this.ok(undefined, createOpaqueId('req')); }
  async getState(accountId: string): Promise<Result<ConnectionState>> { return this.ok({ ...this.state, accountId }, createOpaqueId('req')); }
  async setPresence(input: PresenceInput): Promise<Result<Presence>> { if (this.state.status !== 'connected') return this.error('NOT_CONNECTED', input.requestId, true, 'La cuenta no está conectada.'); const presence: Presence = { jid: input.accountId, availability: input.availability, mode: input.mode, status: input.status, updatedAt: new Date().toISOString() }; this.emit('presence.changed', input.requestId, presence); return this.ok(presence, input.requestId); }
  async listRoster(_accountId: string): Promise<Result<Contact[]>> { if (this.state.status !== 'connected') return this.error('NOT_CONNECTED', createOpaqueId('req'), true, 'La cuenta no está conectada.'); return this.ok([], createOpaqueId('req')); }
  async sendMessage(input: MessageSendInput): Promise<Result<Message>> { if (this.state.status !== 'connected') return this.error('NOT_CONNECTED', input.requestId, true, 'La cuenta no está conectada.'); const message: Message = { id: createOpaqueId('msg'), accountId: this.state.accountId, conversationId: input.conversationId, clientMessageId: input.clientMessageId, senderJid: this.state.accountId, body: input.body, status: 'sent', createdAt: new Date().toISOString() }; this.emit('message.stateChanged', input.clientMessageId, message); return this.ok(message, input.requestId); }
  subscribe(listener: (event: DomainEvent<unknown>) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private nextState(accountId: string, status: ConnectionState['status'], retryable: boolean): ConnectionState { return { accountId, status, retryable, since: new Date().toISOString() }; }
  private emit(type: DomainEvent<unknown>['type'], correlationId: string, payload: unknown): void { const event: DomainEvent<unknown> = { version: 1, eventId: createOpaqueId('evt'), correlationId, type, payload }; this.listeners.forEach((listener) => listener(event)); }
  private ok<T>(value: T, requestId: string): Result<T> { return { ok: true, value, version: 1, requestId }; }
  private error<T>(code: AppError['code'], requestId: string, retryable: boolean, message: string): Result<T> { return { ok: false, version: 1, error: { code, retryable, requestId, message } }; }
}
