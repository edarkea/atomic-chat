import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ElectronXmppPort } from './electron-xmpp.port';
import { MucFacade } from './muc.facade';

const room = (accountId: string, name: string) => ({ service: 'conference.example.invalid', room: name, jid: `${name}@conference.example.invalid` });
const message = (accountId: string, roomJid: string, index: number, generation = 1) => ({ id: `${accountId}-${roomJid}-${index}`, accountId, roomJid, occupantJid: `${roomJid}/nick`, body: { kind: 'text' as const, text: String(index) }, receivedAt: new Date(1700000000000 + index).toISOString(), source: 'live' as const, sessionGeneration: generation });

describe('MucFacade message isolation', () => {
  let emit: (event: unknown) => void;
  beforeEach(() => {
    const port = { subscribe: (listener: (event: unknown) => void) => { emit = listener; return () => undefined; }, discover: async () => ({ ok: true as const, value: [], version: 1 as const, requestId: 'test' }), join: async () => ({ ok: false as const, version: 1 as const, error: { code: 'UNSUPPORTED' as const, retryable: false, requestId: 'test', message: 'test' } }), leave: async () => ({ ok: false as const, version: 1 as const, error: { code: 'UNSUPPORTED' as const, retryable: false, requestId: 'test', message: 'test' } }), sendRoomMessage: async () => ({ ok: false as const, version: 1 as const, error: { code: 'UNSUPPORTED' as const, retryable: false, requestId: 'test', message: 'test' } }) } as unknown as ElectronXmppPort;
    window.atomicChat = { config: { accountId: '', endpoint: { host: 'example.invalid', domain: 'example.invalid', port: 5222, tls: true, allowInsecureTls: false } }, subscribe: port.subscribe } as unknown as typeof window.atomicChat;
    TestBed.configureTestingModule({ providers: [{ provide: ElectronXmppPort, useValue: port }] });
  });

  it('keeps interleaved room buffers and renders only the selected room', () => {
    const facade = TestBed.inject(MucFacade); facade.setAccount('a@example.invalid');
    const first = room('a@example.invalid', 'one'); const second = room('a@example.invalid', 'two');
    emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: first, status: 'joined', participants: [], sessionGeneration: 1 } });
    emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: second, status: 'joined', participants: [], sessionGeneration: 1 } });
    emit({ type: 'muc.messageReceived', payload: message('a@example.invalid', first.jid, 1) }); emit({ type: 'muc.messageReceived', payload: message('a@example.invalid', second.jid, 2) });
    facade.select(first.jid); expect(facade.messages().map((item) => item.body.text)).toEqual(['1']); facade.select(second.jid); expect(facade.messages().map((item) => item.body.text)).toEqual(['2']);
  });

  it('bounds each room at 200 and clears only the abandoned room', () => {
    const facade = TestBed.inject(MucFacade); facade.setAccount('a@example.invalid'); const first = room('a@example.invalid', 'one'); const second = room('a@example.invalid', 'two');
    for (const current of [first, second]) emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: current, status: 'joined', participants: [], sessionGeneration: 1 } });
    for (let index = 0; index < 201; index += 1) emit({ type: 'muc.messageReceived', payload: message('a@example.invalid', first.jid, index) }); emit({ type: 'muc.messageReceived', payload: message('a@example.invalid', second.jid, 1) });
    facade.select(first.jid); expect(facade.messages()).toHaveLength(200); expect(facade.messages()[0].body.text).toBe('1'); facade.select(second.jid); expect(facade.messages()).toHaveLength(1);
  });

  it('shows notices only for the active room and clears them on leave', () => {
    const facade = TestBed.inject(MucFacade); facade.setAccount('a@example.invalid'); const first = room('a@example.invalid', 'one'); const second = room('a@example.invalid', 'two');
    emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: first, status: 'joined', participants: [], sessionGeneration: 1 } }); emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: second, status: 'joined', participants: [], sessionGeneration: 1 } });
    emit({ type: 'muc.notice', payload: { accountId: 'a@example.invalid', roomJid: first.jid, code: 'IDENTITY_VISIBLE', sessionGeneration: 1 } }); emit({ type: 'muc.notice', payload: { accountId: 'b@example.invalid', roomJid: second.jid, code: 'PUBLIC_LOGGING', sessionGeneration: 1 } });
    expect(facade.notices()).toHaveLength(1); expect(facade.notices()[0].roomJid).toBe(first.jid); emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: first, status: 'idle', participants: [], sessionGeneration: 1 } }); expect(facade.notices()).toEqual([]);
  });

  it('paginates participants without empty artificial pages and clamps after shrink', () => {
    const facade = TestBed.inject(MucFacade); facade.setAccount('a@example.invalid');
    for (const total of [0, 100, 101, 150, 200, 201]) {
      const current = room('a@example.invalid', `room-${total}`); const participants = Array.from({ length: total }, (_, index) => ({ occupantJid: `${current.jid}/nick-${index}`, nick: `nick-${index}`, role: 'participant' as const, affiliation: 'member' as const, availability: 'available' as const }));
      emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: current, status: 'joined', participants, sessionGeneration: 1 } }); facade.select(current.jid); while (facade.hasMoreParticipants()) facade.nextParticipantPage(); expect(facade.visibleParticipants()).toHaveLength(total === 0 ? 0 : total % 100 || 100); expect(facade.hasMoreParticipants()).toBe(false); facade.nextParticipantPage(); expect(facade.visibleParticipants()).toHaveLength(total === 0 ? 0 : total % 100 || 100);
    }
    const shrinking = room('a@example.invalid', 'shrinking'); const many = Array.from({ length: 201 }, (_, index) => ({ occupantJid: `${shrinking.jid}/nick-${index}`, nick: `nick-${index}`, role: 'participant' as const, affiliation: 'member' as const, availability: 'available' as const })); emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: shrinking, status: 'joined', participants: many, sessionGeneration: 1 } }); facade.select(shrinking.jid); facade.nextParticipantPage(); facade.nextParticipantPage(); emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: shrinking, status: 'joined', participants: many.slice(0, 50), sessionGeneration: 1 } }); expect(facade.participantPage()).toBe(0); expect(facade.visibleParticipants()).toHaveLength(50);
  });

  it('discards stale discover and join results across account generations', async () => {
    const facade = TestBed.inject(MucFacade); const port = TestBed.inject(ElectronXmppPort) as unknown as { discover: ElectronXmppPort['discover']; join: ElectronXmppPort['join'] }; let releaseDiscover: (value: Awaited<ReturnType<ElectronXmppPort['discover']>>) => void = () => undefined; let releaseJoin: (value: Awaited<ReturnType<ElectronXmppPort['join']>>) => void = () => undefined;
    port.discover = async () => new Promise((resolve) => { releaseDiscover = resolve; }); port.join = async () => new Promise((resolve) => { releaseJoin = resolve; }); facade.setAccount('a@example.invalid'); const discoverA = facade.discover('a@example.invalid'); facade.setAccount('b@example.invalid'); releaseDiscover({ ok: true, value: [room('a@example.invalid', 'late')], version: 1, requestId: 'late' }); await discoverA; expect(facade.services()).toEqual([]);
    const joinA = facade.join('a@example.invalid', 'late@conference.example.invalid', 'a'); facade.setAccount('b@example.invalid'); releaseJoin({ ok: true, value: { accountId: 'a@example.invalid', room: room('a@example.invalid', 'late'), status: 'joined', participants: [], sessionGeneration: 1 }, version: 1, requestId: 'late-join' }); await joinA; expect(facade.selectedRoomJid()).toBe(''); expect(facade.states()).toEqual([]);
    facade.setAccount('a@example.invalid'); const staleAgain = facade.discover('a@example.invalid'); facade.setAccount('b@example.invalid'); facade.setAccount('a@example.invalid'); releaseDiscover({ ok: true, value: [room('a@example.invalid', 'stale-again')], version: 1, requestId: 'stale-again' }); await staleAgain; expect(facade.services()).toEqual([]);
  });

  it('discards stale leave results without clearing the new account buffer', async () => {
    const facade = TestBed.inject(MucFacade); const port = TestBed.inject(ElectronXmppPort) as unknown as { leave: ElectronXmppPort['leave'] }; let releaseLeave: (value: Awaited<ReturnType<ElectronXmppPort['leave']>>) => void = () => undefined; port.leave = async () => new Promise((resolve) => { releaseLeave = resolve; }); const current = room('a@example.invalid', 'one'); facade.setAccount('a@example.invalid'); emit({ type: 'muc.stateChanged', payload: { accountId: 'a@example.invalid', room: current, status: 'joined', participants: [], sessionGeneration: 1 } }); emit({ type: 'muc.messageReceived', payload: message('a@example.invalid', current.jid, 1) }); facade.select(current.jid); const leaveA = facade.leave('a@example.invalid', current.jid); facade.setAccount('b@example.invalid'); const other = room('b@example.invalid', 'two'); emit({ type: 'muc.stateChanged', payload: { accountId: 'b@example.invalid', room: other, status: 'joined', participants: [], sessionGeneration: 1 } }); emit({ type: 'muc.messageReceived', payload: message('b@example.invalid', other.jid, 2) }); facade.select(other.jid); releaseLeave({ ok: true, value: { accountId: 'a@example.invalid', room: current, status: 'idle', participants: [], sessionGeneration: 1 }, version: 1, requestId: 'late-leave' }); await leaveA; expect(facade.messages().map((item) => item.body.text)).toEqual(['2']); expect(facade.selectedRoomJid()).toBe(other.jid);
  });
});
