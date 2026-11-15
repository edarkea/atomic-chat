import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { SidebarViewCoordinator } from './sidebar-view.coordinator';
import type { ConnectionState, Presence, RoomRef, RoomState, UserProfile } from '../../core/domain';

describe('SidebarViewCoordinator', () => {
  const connection = signal<ConnectionState>({
    accountId: 'operator@example.invalid',
    status: 'connected',
    retryable: false,
    since: '2026-01-01T00:00:00.000Z',
    displayName: 'Operator',
  });
  const presence = signal<Presence>({
    jid: 'operator@example.invalid',
    availability: 'available',
    mode: undefined,
    status: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  const services = signal<ReadonlyArray<RoomRef>>([
    {
      jid: 'lobby@conference.example.invalid',
      room: 'lobby',
      service: 'conference.example.invalid',
    },
  ]);
  const emptyRooms = signal<ReadonlyArray<RoomState>>([]);
  const emptyContacts = signal([]);
  const emptyItems = signal<ReadonlyArray<never>>([]);

  function createCoordinator(): SidebarViewCoordinator {
    return new SidebarViewCoordinator({
      connection,
      accountId: signal('operator@example.invalid'),
      presence,
      search: signal(''),
      unreadCounts: signal(new Map([['direct:alice@example.invalid', 2]])),
      nickname: signal('operator'),
      discovering: signal(false),
      mucError: signal(null),
      services,
      mucStates: emptyRooms,
      selectedRoomJid: signal(''),
      activeRoomState: signal(undefined),
      joinedRooms: emptyRooms,
      filteredContacts: emptyContacts,
      workspaceContacts: signal(undefined),
      workspaceItems: emptyItems,
      selectedJid: signal('alice@example.invalid'),
    });
  }

  it('composes operator, MUC and conversation models from current signals', () => {
    const coordinator = createCoordinator();

    expect(coordinator.model().operator).toMatchObject({
      displayName: 'Operator',
      accountId: 'operator@example.invalid',
      connectionLabel: 'Conectado',
      presenceLabel: 'En línea',
      presenceDot: 'online',
    });
    expect(coordinator.model().muc.services).toHaveLength(1);
    expect(
      coordinator.model().conversations.unreadCounts?.get('direct:alice@example.invalid'),
    ).toBe(2);
    expect(coordinator.model().conversations.muc).toBe(coordinator.model().muc);
  });

  it('keeps service filtering and presence option semantics aligned with the existing UI', () => {
    const search = signal('conference');
    const coordinator = new SidebarViewCoordinator({
      connection,
      accountId: signal('operator@example.invalid'),
      presence,
      search,
      unreadCounts: undefined,
      nickname: signal('operator'),
      discovering: signal(false),
      mucError: signal(null),
      services,
      mucStates: emptyRooms,
      selectedRoomJid: signal(''),
      activeRoomState: signal(undefined),
      joinedRooms: emptyRooms,
      filteredContacts: emptyContacts,
      workspaceContacts: signal(undefined),
      workspaceItems: emptyItems,
      selectedJid: signal(''),
    });

    expect(coordinator.model().muc.services).toHaveLength(1);
    presence.set({ ...presence(), mode: 'away', status: 'Al teléfono' });
    expect(coordinator.model().operator.presenceOptionId).toBe('phone');
    presence.set({ ...presence(), mode: 'away', status: '' });
    expect(coordinator.model().operator.presenceOptionId).toBe('away');
  });

  it('exposes independent presence UI state without changing the domain presence', () => {
    const coordinator = createCoordinator();

    coordinator.presenceOpen.set(true);
    coordinator.presenceStatus.set('Disponible');

    expect(coordinator.model().operator.presenceOpen).toBe(true);
    expect(coordinator.model().operator.presenceStatus).toBe('Disponible');
    expect(presence().status).toBe('');
  });

  it('publishes cached own and contact image references without changing contact names', () => {
    const image = {
      referenceId: 'profile-image-1',
      mimeType: 'image/png' as const,
      sizeBytes: '64',
      width: 64,
      height: 64,
      expiresAt: '2026-01-01T01:00:00.000Z',
    };
    const ownProfile = signal<UserProfile>({
      accountId: 'operator@example.invalid',
      jid: 'operator@example.invalid',
      source: 'vcard-temp',
      image,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
    const contactProfiles = signal(
      new Map([
        [
          'alice@example.invalid',
          {
            accountId: 'operator@example.invalid',
            jid: 'alice@example.invalid',
            source: 'vcard-temp' as const,
            image,
            fetchedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      ]),
    );
    const coordinator = new SidebarViewCoordinator({
      connection,
      accountId: signal('operator@example.invalid'),
      ownProfile,
      contactProfiles,
      presence,
      search: signal(''),
      unreadCounts: undefined,
      nickname: signal('operator'),
      discovering: signal(false),
      mucError: signal(null),
      services,
      mucStates: emptyRooms,
      selectedRoomJid: signal(''),
      activeRoomState: signal(undefined),
      joinedRooms: emptyRooms,
      filteredContacts: emptyContacts,
      workspaceContacts: signal(undefined),
      workspaceItems: emptyItems,
      selectedJid: signal('alice@example.invalid'),
    });

    expect(coordinator.model().operator.profileImage?.referenceId).toBe('profile-image-1');
    expect(
      coordinator.model().conversations.profileImages?.get('alice@example.invalid')?.referenceId,
    ).toBe('profile-image-1');
  });
});
