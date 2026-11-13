import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewMessageCoordinator } from './new-message.coordinator';
import type { Contact, RoomRef } from '../domain';

describe('NewMessageCoordinator', () => {
  let accountId: ReturnType<typeof signal<string>>;
  let contacts: ReturnType<typeof signal<ReadonlyArray<Contact>>>;
  let services: ReturnType<typeof signal<ReadonlyArray<RoomRef>>>;
  let error: ReturnType<typeof signal<string | null>>;
  let discover: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let join: ReturnType<
    typeof vi.fn<(accountId: string, roomJid: string, nickname: string) => Promise<void>>
  >;
  let selectJoinedRoom: ReturnType<typeof vi.fn<(roomJid: string) => void>>;
  const joinedRooms = signal([]);
  let coordinator: NewMessageCoordinator;

  beforeEach(() => {
    accountId = signal('operator@example.invalid');
    contacts = signal<ReadonlyArray<Contact>>([
      { jid: 'alice@example.invalid', name: 'Alice', groups: [] },
      { jid: 'bob@example.invalid', groups: [] },
    ]);
    services = signal<ReadonlyArray<RoomRef>>([
      {
        jid: 'lobby@conference.example.invalid',
        room: 'lobby',
        service: 'conference.example.invalid',
      },
    ]);
    error = signal<string | null>(null);
    discover = vi.fn<() => Promise<void>>(async () => undefined);
    join = vi.fn<(account: string, roomJid: string, nickname: string) => Promise<void>>(
      async () => undefined,
    );
    selectJoinedRoom = vi.fn<(roomJid: string) => void>();
    coordinator = new NewMessageCoordinator({
      chat: { accountId, contacts },
      muc: { error, services, discover, join },
      isJoinedRoom: (currentAccount, roomJid) =>
        currentAccount === accountId() && roomJid === 'lobby@conference.example.invalid',
      selectJoinedRoom,
      joinedRooms,
    });
  });

  it('filters contacts and services using the dialog search', () => {
    coordinator.setSearch('alice');
    expect(coordinator.contacts().map((contact) => contact.jid)).toEqual(['alice@example.invalid']);
    expect(coordinator.services()).toEqual([]);

    coordinator.setSearch('conference');
    expect(coordinator.contacts()).toEqual([]);
    expect(coordinator.services()).toHaveLength(1);
  });

  it('resets local dialog state when opening and closing', () => {
    coordinator.setSearch('old query');
    coordinator.localError.set('invalid');
    coordinator.openDialog();
    expect(coordinator.open()).toBe(true);
    expect(coordinator.search()).toBe('');
    expect(coordinator.localError()).toBeNull();

    coordinator.joiningRoom.set('lobby@conference.example.invalid');
    coordinator.closeDialog();
    expect(coordinator.open()).toBe(false);
    expect(coordinator.joiningRoom()).toBeNull();
  });

  it('exposes the complete dialog model from coordinator-owned state', () => {
    coordinator.openDialog();
    coordinator.nickname.set('operator');
    expect(coordinator.dialogModel()).toMatchObject({
      search: '',
      contacts: expect.any(Array),
      joinedRooms: [],
      services: expect.any(Array),
      nickname: 'operator',
      discovering: false,
      joiningRoomJid: null,
      error: null,
    });
  });

  it('delegates discovery and joins the current account with a nickname', async () => {
    coordinator.nickname.set(' operator ');
    await coordinator.discoverRooms();
    await coordinator.joinRoom('lobby@conference.example.invalid');

    expect(discover).toHaveBeenCalledWith('operator@example.invalid');
    expect(join).toHaveBeenCalledWith(
      'operator@example.invalid',
      'lobby@conference.example.invalid',
      'operator',
    );
    expect(selectJoinedRoom).toHaveBeenCalledWith('lobby@conference.example.invalid');
    expect(coordinator.discovering()).toBe(false);
    expect(coordinator.joiningRoom()).toBeNull();
  });

  it('does not update visual state after destruction', async () => {
    let release!: () => void;
    discover.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const pending = coordinator.discoverRooms();
    coordinator.destroy();
    release();
    await pending;

    expect(coordinator.open()).toBe(false);
    expect(coordinator.discovering()).toBe(false);
    expect(selectJoinedRoom).not.toHaveBeenCalled();
  });
});
