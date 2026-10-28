import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import { DomainEvent, MucJoinInput, MucNotice, MucSendInput, RoomMessage, RoomParticipant, RoomRef, RoomState } from './domain';
import { ElectronXmppPort } from './electron-xmpp.port';

@Injectable({ providedIn: 'root' })
export class MucFacade {
  private readonly port = inject(ElectronXmppPort);
  readonly services = signal<ReadonlyArray<RoomRef>>([]);
  readonly states = signal<ReadonlyArray<RoomState>>([]);
  readonly selectedRoomJid = signal('');
  private readonly messageBuffers = new Map<string, ReadonlyArray<RoomMessage>>();
  private readonly messageVersion = signal(0);
  readonly messages = computed<ReadonlyArray<RoomMessage>>(() => { this.messageVersion(); return this.messageBuffers.get(this.roomKey(this.accountId(), this.selectedRoomJid())) || []; });
  readonly participants = computed<ReadonlyArray<RoomParticipant>>(() => this.states().find((state) => state.room.jid === this.selectedRoomJid())?.participants || []);
  readonly participantPage = signal(0);
  // La paginación limita los elementos renderizados a 100; `participants` conserva la lista completa.
  readonly visibleParticipants = computed<ReadonlyArray<RoomParticipant>>(() => this.participants().slice(this.participantPage() * 100, this.participantPage() * 100 + 100));
  readonly hasMoreParticipants = computed(() => (this.participantPage() + 1) * 100 < this.participants().length);
  readonly selectedState = computed(() => this.states().find((state) => state.room.jid === this.selectedRoomJid()));
  readonly error = signal<string | null>(null);
  readonly notices = signal<ReadonlyArray<MucNotice>>([]);
  readonly visibleNotices = computed<ReadonlyArray<MucNotice>>(() => this.notices().filter((notice) => notice.roomJid === this.selectedRoomJid()));
  private readonly activeAccountId = signal('');
  private accountGeneration = 0;
  private readonly destroyRef = inject(DestroyRef);
  private readonly roomGenerations = new Map<string, number>();
  private unsubscribe: () => void = () => undefined;

  constructor() {
    if (typeof window !== 'undefined' && window.atomicChat) { this.unsubscribe = this.port.subscribe((event) => this.onEvent(event)); this.destroyRef.onDestroy(() => this.unsubscribe()); }
  }

  async discover(accountId: string): Promise<void> {
    if (!window.atomicChat) return; this.activateAccount(accountId); const generation = this.accountGeneration;
    const result = await this.port.discover({ version: 1, requestId: createOpaqueId('muc-discover'), accountId });
    if (!this.isCurrent(accountId, generation)) return; if (result.ok) { this.services.set(result.value); this.error.set(null); } else this.error.set(result.error.message);
  }

  setAccount(accountId: string): void { if (this.activeAccountId() === accountId) return; this.activateAccount(accountId); this.services.set([]); this.states.set([]); this.clearAllMessages(); this.notices.set([]); this.selectedRoomJid.set(''); this.roomGenerations.clear(); this.error.set(null); }

  async join(accountId: string, roomJid: string, nickname: string): Promise<void> {
    this.activateAccount(accountId); const generation = this.accountGeneration;
    const input: MucJoinInput = { version: 1, requestId: createOpaqueId('muc-join'), accountId, roomJid, nickname };
    const result = await this.port.join(input); if (!this.isCurrent(accountId, generation)) return; if (result.ok) { this.upsertState(result.value); this.selectedRoomJid.set(result.value.room.jid); this.error.set(null); } else this.error.set(result.error.message);
  }

  async leave(accountId: string, roomJid: string): Promise<void> {
    this.activateAccount(accountId); const generation = this.accountGeneration;
    const result = await this.port.leave({ version: 1, requestId: createOpaqueId('muc-leave'), accountId, roomJid }); if (!this.isCurrent(accountId, generation)) return; if (result.ok) { this.upsertState(result.value); this.messageBuffers.delete(this.roomKey(accountId, roomJid)); this.messageVersion.update((version) => version + 1); this.clearRoomNotices(roomJid); } else this.error.set(result.error.message);
  }

  async send(accountId: string, roomJid: string, text: string): Promise<boolean> {
    this.activeAccountId.set(accountId);
    const body = text.trim(); if (!body) return false;
    const input: MucSendInput = { version: 1, requestId: createOpaqueId('muc-send'), accountId, roomJid, clientMessageId: createOpaqueId('muc-client'), body: { kind: 'text', text: body } };
    const result = await this.port.sendRoomMessage(input); if (!result.ok) { this.error.set(result.error.message); return false; } return true;
  }

  select(roomJid: string): void { this.selectedRoomJid.set(roomJid); this.participantPage.set(0); }
  nextParticipantPage(): void { if (this.hasMoreParticipants()) this.participantPage.update((page) => page + 1); }
  previousParticipantPage(): void { this.participantPage.update((page) => Math.max(0, page - 1)); }

  private onEvent(event: DomainEvent<unknown>): void {
    if (event.type === 'connection.stateChanged') { const state = event.payload as { accountId: string; status: string }; if (state.accountId === this.accountId() && ['connected', 'idle', 'failed'].includes(state.status)) this.accountGeneration += 1; if (state.accountId === this.accountId() && ['idle', 'failed'].includes(state.status)) { this.states.set([]); this.services.set([]); this.clearAccountMessages(state.accountId); this.notices.set([]); this.selectedRoomJid.set(''); this.roomGenerations.clear(); } return; }
    if (event.type === 'muc.stateChanged') { const state = event.payload as RoomState; if (state.accountId !== this.accountId()) return; this.roomGenerations.set(state.room.jid, state.sessionGeneration); this.upsertState(state); if (state.status === 'idle' || state.status === 'failed') this.clearRoomNotices(state.room.jid); if (state.status === 'failed' && state.errorCode) this.error.set(`La sala no pudo abrirse (${state.errorCode}).`); return; }
    if (event.type === 'muc.participantChanged') { const payload = event.payload as { accountId: string; room: RoomRef; participant: RoomParticipant; sessionGeneration: number }; if (payload.accountId !== this.accountId() || this.roomGenerations.get(payload.room.jid) !== payload.sessionGeneration) return; this.states.update((states) => states.map((state) => { if (state.room.jid !== payload.room.jid) return state; const participants = state.participants.filter((item) => item.occupantJid !== payload.participant.occupantJid); return { ...state, participants: payload.participant.availability === 'unavailable' ? participants : [...participants, payload.participant] }; })); this.normalizeParticipantPage(); return; }
    if (event.type === 'muc.messageReceived') { const message = event.payload as RoomMessage; if (message.accountId === this.accountId() && message.source === 'live' && this.roomGenerations.get(message.roomJid) === message.sessionGeneration) { const key = this.roomKey(message.accountId, message.roomJid); this.messageBuffers.set(key, [...(this.messageBuffers.get(key) || []), message].slice(-200)); this.messageVersion.update((version) => version + 1); } }
    if (event.type === 'muc.notice') { const notice = event.payload as MucNotice; if (notice.accountId === this.accountId() && this.roomGenerations.get(notice.roomJid) === notice.sessionGeneration) this.notices.update((items) => [...items.filter((item) => item.roomJid !== notice.roomJid || item.code !== notice.code), notice]); }
  }

  private upsertState(state: RoomState): void { this.states.update((states) => states.some((item) => item.room.jid === state.room.jid) ? states.map((item) => item.room.jid === state.room.jid ? state : item) : [...states, state]); this.normalizeParticipantPage(); }
  private accountId(): string { return this.activeAccountId() || window.atomicChat?.config.accountId || ''; }
  private activateAccount(accountId: string): void { if (this.activeAccountId() !== accountId) { this.activeAccountId.set(accountId); this.accountGeneration += 1; } }
  private isCurrent(accountId: string, generation: number): boolean { return this.accountId() === accountId && this.accountGeneration === generation; }
  private roomKey(accountId: string, roomJid: string): string { return `${accountId.toLowerCase()}|${roomJid.toLowerCase()}`; }
  private clearAccountMessages(accountId: string): void { const prefix = `${accountId.toLowerCase()}|`; for (const key of this.messageBuffers.keys()) if (key.startsWith(prefix)) this.messageBuffers.delete(key); this.messageVersion.update((version) => version + 1); }
  private clearAllMessages(): void { this.messageBuffers.clear(); this.messageVersion.update((version) => version + 1); }
  private clearRoomNotices(roomJid: string): void { this.notices.update((items) => items.filter((item) => item.roomJid !== roomJid)); }
  private normalizeParticipantPage(): void { const total = this.participants().length; const lastPage = Math.max(0, Math.ceil(total / 100) - 1); if (this.participantPage() > lastPage) this.participantPage.set(lastPage); }
}
