import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationTimelineCoordinator } from './conversation-timeline.coordinator';
import type { InitialHistoryState } from './conversation-history.coordinator';
import type { FileTransfer, HistoryTimelineItem, Message } from '../domain';

describe('ConversationTimelineCoordinator', () => {
  const accountId = signal('a@example.invalid');
  const selectedJid = signal('contact@example.invalid');
  const messages = signal<ReadonlyArray<Message>>([]);
  const initialHistory = signal<InitialHistoryState | null>(null);
  const timelineItems = signal<ReadonlyArray<HistoryTimelineItem>>([]);
  const timelineSupported = signal(false);
  const contactsByBareJid = signal(
    new Map([
      ['contact@example.invalid', { jid: 'contact@example.invalid', name: 'Contacto', groups: [] }],
    ]),
  );
  let transfers: FileTransfer[];
  let coordinator: ConversationTimelineCoordinator;

  beforeEach(() => {
    messages.set([]);
    initialHistory.set(null);
    timelineItems.set([]);
    timelineSupported.set(false);
    transfers = [];
    coordinator = new ConversationTimelineCoordinator({
      chat: { accountId, messages, initialHistory, timelineItems, timelineSupported },
      files: {
        forConversation: vi.fn(() => transfers),
        mediaForTransfer: vi.fn(() => undefined),
        label: vi.fn(() => 'Archivo'),
      },
      selectedJid,
      contactsByBareJid,
    });
  });

  it('does not expose messages before the selected history is ready', () => {
    messages.set([
      {
        id: 'message-1',
        accountId: 'a@example.invalid',
        conversationId: 'contact@example.invalid',
        clientMessageId: 'client-1',
        senderJid: 'contact@example.invalid',
        body: { kind: 'text', text: 'hola' },
        status: 'sent',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    expect(coordinator.timeline()).toEqual([]);
    initialHistory.set({
      accountId: 'a@example.invalid',
      conversationId: 'contact@example.invalid',
      generation: 1,
      status: 'ready',
    });
    expect(coordinator.timeline()[0]?.senderLabel).toBe('Contacto');
  });

  it('filters by account and conversation and preserves chronological order', () => {
    initialHistory.set({
      accountId: 'a@example.invalid',
      conversationId: 'contact@example.invalid',
      generation: 1,
      status: 'ready',
    });
    messages.set([
      {
        id: 'other-account',
        accountId: 'b@example.invalid',
        conversationId: 'contact@example.invalid',
        clientMessageId: 'other-account',
        senderJid: 'contact@example.invalid',
        body: { kind: 'text', text: 'fuera' },
        status: 'sent',
        createdAt: '2026-01-01T00:01:00.000Z',
      },
      {
        id: 'message-2',
        accountId: 'a@example.invalid',
        conversationId: 'contact@example.invalid/resource',
        clientMessageId: 'client-2',
        senderJid: 'a@example.invalid/resource',
        body: { kind: 'text', text: 'segundo' },
        status: 'sent',
        createdAt: '2026-01-01T00:02:00.000Z',
      },
      {
        id: 'message-1',
        accountId: 'a@example.invalid',
        conversationId: 'contact@example.invalid',
        clientMessageId: 'client-1',
        senderJid: 'contact@example.invalid',
        body: { kind: 'text', text: 'primero' },
        status: 'sent',
        createdAt: '2026-01-01T00:01:00.000Z',
      },
    ]);

    expect(coordinator.visibleMessages().map((message) => message.id)).toEqual([
      'message-2',
      'message-1',
    ]);
    expect(coordinator.timeline().map((item) => item.id)).toEqual([
      'text:client-1',
      'text:client-2',
    ]);
    const outgoing = messages().find((message) => message.id === 'message-2');
    expect(outgoing).toBeDefined();
    if (outgoing) expect(coordinator.directSenderLabel(outgoing)).toBe('Tú');
  });

  it('hides cancelled outgoing images without a persisted media record', () => {
    initialHistory.set({
      accountId: 'a@example.invalid',
      conversationId: 'contact@example.invalid',
      generation: 1,
      status: 'ready',
    });
    transfers = [
      {
        offer: {
          transferId: 'image-1',
          accountId: 'a@example.invalid',
          conversationId: 'contact@example.invalid',
          senderJid: 'a@example.invalid',
          name: 'image.png',
          sizeBytes: '10',
          mimeType: 'image/png',
          transport: 'ibb',
          offeredAt: '2026-01-01T00:00:00.000Z',
        },
        direction: 'outgoing',
        state: 'cancelled',
        bytesTransferred: '0',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    expect(coordinator.timeline()).toEqual([]);
  });
});
