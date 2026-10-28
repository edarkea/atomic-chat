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
});
