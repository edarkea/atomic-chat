import { describe, expect, it, vi } from 'vitest';
import {
  CertificateTrustRequest,
  ConnectionState,
  FileOffer,
  FileTransfer,
  Message,
  MucNotice,
  Presence,
  RoomMessage,
  RoomParticipant,
  RoomRef,
  RoomState,
  TypedDomainEvent,
} from './domain';
import { validateDomainEvent, subscribeToDomainEvents } from './domain-event.validation';
import { InMemoryXmppPort } from './in-memory-xmpp.port';

const envelope = (type: string, payload: unknown, correlationId = 'correlation-1') => ({
  version: 1,
  eventId: 'event-1',
  correlationId,
  type,
  payload,
});

const room: RoomRef = {
  service: 'conference.example.invalid',
  room: 'lobby',
  jid: 'lobby@conference.example.invalid',
};
const participant: RoomParticipant = {
  occupantJid: `${room.jid}/operator`,
  nick: 'operator',
  role: 'participant',
  affiliation: 'member',
  availability: 'available',
};
const message: Message = {
  id: 'message-1',
  accountId: 'a@example.invalid',
  conversationId: 'b@example.invalid',
  clientMessageId: 'client-1',
  senderJid: 'b@example.invalid',
  body: { kind: 'text', text: 'hola' },
  status: 'sent',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const presence: Presence = {
  jid: 'a@example.invalid',
  availability: 'available',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const fileOffer: FileOffer = {
  transferId: 'file-1',
  accountId: 'a@example.invalid',
  conversationId: 'b@example.invalid',
  senderJid: 'b@example.invalid',
  name: 'fixture.txt',
  sizeBytes: '12',
  transport: 'ibb',
  offeredAt: '2026-01-01T00:00:00.000Z',
};

describe('domain event validation', () => {
  it('narrows each payload using the event discriminator', () => {
    const event = validateDomainEvent(envelope('message.received', message));
    expect(event?.type).toBe('message.received');
    if (!event || event.type !== 'message.received')
      throw new Error('message event was not narrowed');
    const body: string = event.payload.body.text;
    expect(body).toBe('hola');
  });

  it('validates all producer-backed payload shapes', () => {
    const connection: ConnectionState = {
      accountId: 'a@example.invalid',
      status: 'connected',
      retryable: false,
      since: '2026-01-01T00:00:00.000Z',
    };
    const certificate: CertificateTrustRequest = {
      requestId: 'certificate-1',
      accountId: 'a@example.invalid',
      host: 'xmpp.example.invalid',
      port: 5222,
      transport: 'starttls',
      certificate: {
        fingerprintSha256: 'AA',
        subject: 'CN=xmpp.example.invalid',
        issuer: 'CA',
        validFrom: '2026-01-01',
        validTo: '2027-01-01',
        subjectAltNames: ['DNS:xmpp.example.invalid'],
        chain: [{ fingerprintSha256: 'AA', subject: 'CN=xmpp.example.invalid', issuer: 'CA' }],
        pem: 'pem',
      },
    };
    const state: RoomState = {
      accountId: 'a@example.invalid',
      room,
      status: 'joined',
      participants: [participant],
      sessionGeneration: 4,
    };
    const mucMessage: RoomMessage = {
      id: 'room-message-1',
      accountId: 'a@example.invalid',
      roomJid: room.jid,
      occupantJid: participant.occupantJid,
      body: { kind: 'text', text: 'mensaje' },
      receivedAt: '2026-01-01T00:00:00.000Z',
      source: 'live',
      sessionGeneration: 4,
    };
    const notice: MucNotice = {
      accountId: 'a@example.invalid',
      roomJid: room.jid,
      code: 'SERVER_NICKNAME',
      nickname: 'operator',
      sessionGeneration: 4,
    };
    const transfer: FileTransfer = {
      offer: fileOffer,
      direction: 'incoming',
      state: 'offered',
      bytesTransferred: '0',
      updatedAt: fileOffer.offeredAt,
    };
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ['connection.stateChanged', connection],
      ['presence.changed', presence],
      ['message.stateChanged', message],
      ['message.received', message],
      ['certificate.trustRequired', certificate],
      ['muc.stateChanged', state],
      [
        'muc.participantChanged',
        { accountId: state.accountId, room, participant, sessionGeneration: 4 },
      ],
      ['muc.messageReceived', mucMessage],
      ['muc.notice', notice],
      ['file.offerReceived', fileOffer],
      ['file.stateChanged', transfer],
    ];
    for (const [type, payload] of cases)
      expect(validateDomainEvent(envelope(type, payload))?.type).toBe(type);
  });

  it('preserves optional presence account identity and event correlation', () => {
    const withoutAccount = validateDomainEvent(
      envelope('presence.changed', presence, 'presence-1'),
    );
    const withAccount = validateDomainEvent(
      envelope('presence.changed', { ...presence, accountId: 'b@example.invalid' }, 'presence-2'),
    );
    expect(withoutAccount?.type).toBe('presence.changed');
    expect(withoutAccount?.correlationId).toBe('presence-1');
    expect(withAccount?.type).toBe('presence.changed');
    if (withAccount?.type === 'presence.changed')
      expect(withAccount.payload.accountId).toBe('b@example.invalid');
  });

  it('rejects null, arrays, unknown types and missing required fields', () => {
    expect(validateDomainEvent(null)).toBeUndefined();
    expect(validateDomainEvent([])).toBeUndefined();
    expect(validateDomainEvent(envelope('unknown.event', message))).toBeUndefined();
    expect(
      validateDomainEvent(envelope('message.received', { ...message, accountId: undefined })),
    ).toBeUndefined();
    expect(validateDomainEvent(envelope('muc.stateChanged', { ...room }))).toBeUndefined();
    expect(
      validateDomainEvent(envelope('file.stateChanged', { offer: fileOffer, state: 'unknown' })),
    ).toBeUndefined();
  });

  it('drops malformed events at the subscription boundary and preserves valid identity', () => {
    let receive!: (event: unknown) => void;
    const listener = vi.fn<(event: TypedDomainEvent) => void>();
    const unsubscribe = subscribeToDomainEvents((handler) => {
      receive = handler;
      return () => undefined;
    }, listener);
    const valid = envelope('message.received', message, 'message-correlation');
    receive({ ...valid, eventId: 'foreign-event' });
    receive({ ...valid, payload: null });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].eventId).toBe('foreign-event');
    expect(listener.mock.calls[0][0].correlationId).toBe('message-correlation');
    unsubscribe();
  });

  it('keeps the InMemory port compatible with typed subscriptions', async () => {
    const port = new InMemoryXmppPort();
    let received: TypedDomainEvent | undefined;
    port.subscribe((event) => {
      received = event;
    });
    await port.connect({
      version: 1,
      requestId: 'connect-1',
      accountId: 'a@example.invalid',
      endpoint: { host: 'example.invalid', port: 5222, tls: true },
    });
    expect(received?.type).toBe('connection.stateChanged');
    if (received?.type === 'connection.stateChanged')
      expect(received.payload.accountId).toBe('a@example.invalid');
  });
});
