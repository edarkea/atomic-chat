import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatFacade } from '../facades/chat.facade';
import { Contact } from '../domain';
import { MucFacade } from '../facades/muc.facade';
import { ConversationVisibilityStore } from '../stores/conversation-visibility.store';
import { WorkspaceCoordinator } from './workspace.coordinator';

describe('WorkspaceCoordinator', () => {
  const accountId = signal('alice@example.invalid');
  const connected = signal(true);
  const contacts = signal<ReadonlyArray<Contact>>([
    {
      jid: 'bob@example.invalid/resource',
      name: 'Bob',
      groups: ['friends'],
      source: 'roster',
    },
    {
      jid: 'carol@example.invalid',
      name: 'Carol',
      groups: [],
      source: 'roster',
    },
  ]);
  const isHidden = vi.fn(() => false);
  const reveal = vi.fn();
  const hide = vi.fn();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ChatFacade,
          useValue: {
            accountId,
            isConnected: connected,
            contacts,
            conversationSummaries: signal([]),
          } as unknown as ChatFacade,
        },
        {
          provide: MucFacade,
          useValue: {
            states: signal([]),
            roomActivity: signal(new Map()),
            select: vi.fn(),
            clearSelection: vi.fn(),
          } as unknown as MucFacade,
        },
        {
          provide: ConversationVisibilityStore,
          useValue: { isHidden, reveal, hide } as unknown as ConversationVisibilityStore,
        },
        WorkspaceCoordinator,
      ],
    });
    isHidden.mockClear();
    reveal.mockClear();
    hide.mockClear();
  });

  it('filters contacts and preserves the account-scoped direct selection', () => {
    const coordinator = TestBed.inject(WorkspaceCoordinator);

    coordinator.search.set('bob');
    expect(coordinator.filteredContacts().map((contact) => contact.jid)).toEqual([
      'bob@example.invalid/resource',
    ]);

    const contact = contacts()[0];
    coordinator.selectDirect(contact.jid, contact);

    expect(coordinator.activeSelection()).toEqual({
      kind: 'direct',
      accountId: 'alice@example.invalid',
      jid: 'bob@example.invalid',
    });
    expect(coordinator.selectedContact()).toBe(contact);
    expect(reveal).toHaveBeenCalledWith(
      'alice@example.invalid',
      'direct',
      'bob@example.invalid/resource',
    );
  });

  it('invalidates a selection that belongs to another account', () => {
    const coordinator = TestBed.inject(WorkspaceCoordinator);

    coordinator.conversationSelection.set({
      kind: 'direct',
      accountId: 'other@example.invalid',
      jid: 'bob@example.invalid',
    });

    expect(coordinator.activeSelection()).toEqual({
      kind: 'none',
      accountId: 'alice@example.invalid',
    });
  });
});
