import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import { DomainEvent, MucJoinInput, MucSendInput, RoomMessage, RoomParticipant, RoomRef, RoomState } from './domain';
import { ElectronXmppPort } from './electron-xmpp.port';

@Injectable({ providedIn: 'root' })
export class MucFacade {
  private readonly port = inject(ElectronXmppPort);
  readonly services = signal<ReadonlyArray<RoomRef>>([]);
  readonly states = signal<ReadonlyArray<RoomState>>([]);
  readonly selectedRoomJid = signal('');
  readonly messages = signal<ReadonlyArray<RoomMessage>>([]);
  readonly participants = computed<ReadonlyArray<RoomParticipant>>(() => this.states().find((state) => state.room.jid === this.selectedRoomJid())?.participants || []);
  readonly participantPage = signal(0);
  readonly visibleParticipants = computed<ReadonlyArray<RoomParticipant>>(() => this.participants().slice(this.participantPage() * 100, this.participantPage() * 100 + 100));
  readonly hasMoreParticipants = computed(() => this.visibleParticipants().length < this.participants().length);
  readonly selectedState = computed(() => this.states().find((state) => state.room.jid === this.selectedRoomJid()));
  readonly error = signal<string | null>(null);
  private readonly activeAccountId = signal('');
  private readonly destroyRef = inject(DestroyRef);
  private readonly roomGenerations = new Map<string, number>();
  private unsubscribe: () => void = () => undefined;

  constructor() {
    if (typeof window !== 'undefined' && window.atomicChat) { this.unsubscribe = this.port.subscribe((event) => this.onEvent(event)); this.destroyRef.onDestroy(() => this.unsubscribe()); }
  }

  async discover(accountId: string): Promise<void> {
    if (!window.atomicChat) return; this.activeAccountId.set(accountId);
    const result = await this.port.discover({ version: 1, requestId: createOpaqueId('muc-discover'), accountId });
    if (result.ok) { this.services.set(result.value); this.error.set(null); } else this.error.set(result.error.message);
  }

  setAccount(accountId: string): void { if (this.activeAccountId() === accountId) return; this.activeAccountId.set(accountId); this.services.set([]); this.states.set([]); this.messages.set([]); this.selectedRoomJid.set(''); this.roomGenerations.clear(); this.error.set(null); }

  async join(accountId: string, roomJid: string, nickname: string): Promise<void> {
    this.activeAccountId.set(accountId);
    const input: MucJoinInput = { version: 1, requestId: createOpaqueId('muc-join'), accountId, roomJid, nickname };
    const result = await this.port.join(input); if (result.ok) { this.upsertState(result.value); this.selectedRoomJid.set(result.value.room.jid); this.error.set(null); } else this.error.set(result.error.message);
  }

  async leave(accountId: string, roomJid: string): Promise<void> {
    this.activeAccountId.set(accountId);
    const result = await this.port.leave({ version: 1, requestId: createOpaqueId('muc-leave'), accountId, roomJid }); if (result.ok) { this.upsertState(result.value); this.messages.update((items) => items.filter((message) => message.roomJid !== roomJid)); } else this.error.set(result.error.message);
  }

  async send(accountId: string, roomJid: string, text: string): Promise<boolean> {
    this.activeAccountId.set(accountId);
    const body = text.trim(); if (!body) return false;
    const input: MucSendInput = { version: 1, requestId: createOpaqueId('muc-send'), accountId, roomJid, clientMessageId: createOpaqueId('muc-client'), body: { kind: 'text', text: body } };
    const result = await this.port.sendRoomMessage(input); if (!result.ok) { this.error.set(result.error.message); return false; } return true;
  }

  select(roomJid: string): void { this.selectedRoomJid.set(roomJid); this.participantPage.set(0); this.messages.update((items) => items.filter((message) => message.roomJid === roomJid)); }
  nextParticipantPage(): void { if (this.hasMoreParticipants()) this.participantPage.update((page) => page + 1); }
  previousParticipantPage(): void { this.participantPage.update((page) => Math.max(0, page - 1)); }

  private onEvent(event: DomainEvent<unknown>): void {
    if (event.type === 'connection.stateChanged') { const state = event.payload as { accountId: string; status: string }; if (state.accountId === this.accountId() && ['idle', 'failed'].includes(state.status)) { this.states.set([]); this.services.set([]); this.messages.set([]); this.selectedRoomJid.set(''); this.roomGenerations.clear(); } return; }
    if (event.type === 'muc.stateChanged') { const state = event.payload as RoomState; if (state.accountId !== this.accountId()) return; this.roomGenerations.set(state.room.jid, state.sessionGeneration); this.upsertState(state); if (state.status === 'failed' && state.errorCode) this.error.set(`La sala no pudo abrirse (${state.errorCode}).`); return; }
    if (event.type === 'muc.participantChanged') { const payload = event.payload as { accountId: string; room: RoomRef; participant: RoomParticipant; sessionGeneration: number }; if (payload.accountId !== this.accountId() || this.roomGenerations.get(payload.room.jid) !== payload.sessionGeneration) return; this.states.update((states) => states.map((state) => { if (state.room.jid !== payload.room.jid) return state; const participants = state.participants.filter((item) => item.occupantJid !== payload.participant.occupantJid); return { ...state, participants: payload.participant.availability === 'unavailable' ? participants : [...participants, payload.participant] }; })); return; }
    if (event.type === 'muc.messageReceived') { const message = event.payload as RoomMessage; if (message.accountId === this.accountId() && message.source === 'live' && this.roomGenerations.get(message.roomJid) === message.sessionGeneration) this.messages.update((items) => [...items, message].slice(-200)); }
  }

  private upsertState(state: RoomState): void { this.states.update((states) => states.some((item) => item.room.jid === state.room.jid) ? states.map((item) => item.room.jid === state.room.jid ? state : item) : [...states, state]); }
  private accountId(): string { return this.activeAccountId() || window.atomicChat?.config.accountId || ''; }
}
