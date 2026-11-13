import { computed, signal, type Signal } from '@angular/core';
import type { Contact, RoomRef, RoomState } from '../domain';

export interface NewMessageCoordinatorChat {
  readonly accountId: Signal<string>;
  readonly contacts: Signal<ReadonlyArray<Contact>>;
}

export interface NewMessageDialogViewModel {
  readonly search: string;
  readonly contacts: ReadonlyArray<Contact>;
  readonly joinedRooms: ReadonlyArray<RoomState>;
  readonly services: ReadonlyArray<RoomRef>;
  readonly nickname: string;
  readonly discovering: boolean;
  readonly joiningRoomJid: string | null;
  readonly error: string | null;
}

export interface NewMessageCoordinatorMuc {
  readonly error: Signal<string | null>;
  readonly services: Signal<ReadonlyArray<RoomRef>>;
  discover(accountId: string): Promise<void>;
  join(accountId: string, roomJid: string, nickname: string): Promise<void>;
}

export interface NewMessageCoordinatorDependencies {
  readonly chat: NewMessageCoordinatorChat;
  readonly muc: NewMessageCoordinatorMuc;
  readonly isJoinedRoom: (accountId: string, roomJid: string) => boolean;
  readonly selectJoinedRoom: (roomJid: string) => void;
  readonly joinedRooms: Signal<ReadonlyArray<RoomState>>;
}

export class NewMessageCoordinator {
  readonly open = signal(false);
  readonly search = signal('');
  readonly nickname = signal('');
  readonly joiningRoom = signal<string | null>(null);
  readonly localError = signal<string | null>(null);
  readonly discovering = signal(false);
  readonly dialogModel = computed<NewMessageDialogViewModel>(() => ({
    search: this.search(),
    contacts: this.contacts(),
    joinedRooms: this.dependencies.joinedRooms(),
    services: this.services(),
    nickname: this.nickname(),
    discovering: this.discovering(),
    joiningRoomJid: this.joiningRoom(),
    error: this.localError() || this.dependencies.muc.error(),
  }));

  readonly contacts = computed<ReadonlyArray<Contact>>(() => {
    const term = this.search().trim().toLowerCase();
    return this.dependencies.chat
      .contacts()
      .filter(
        (contact) =>
          !term ||
          contact.jid.toLowerCase().includes(term) ||
          contact.name?.toLowerCase().includes(term),
      );
  });

  readonly services = computed<ReadonlyArray<RoomRef>>(() => {
    const term = this.search().trim().toLowerCase();
    return this.dependencies.muc
      .services()
      .filter(
        (room) =>
          !term ||
          room.jid.toLowerCase().includes(term) ||
          room.room.toLowerCase().includes(term) ||
          room.service.toLowerCase().includes(term),
      );
  });

  private destroyed = false;

  constructor(private readonly dependencies: NewMessageCoordinatorDependencies) {}

  openDialog(): void {
    if (this.destroyed) return;
    this.search.set('');
    this.localError.set(null);
    this.open.set(true);
  }

  closeDialog(): void {
    if (this.destroyed) return;
    this.open.set(false);
    this.joiningRoom.set(null);
  }

  setSearch(value: string): void {
    if (this.destroyed) return;
    this.search.set(value);
    this.localError.set(null);
  }

  async discoverRooms(): Promise<void> {
    if (this.destroyed) return;
    this.discovering.set(true);
    try {
      await this.dependencies.muc.discover(this.dependencies.chat.accountId());
    } finally {
      if (!this.destroyed) this.discovering.set(false);
    }
  }

  async joinRoom(roomJid: string): Promise<void> {
    if (this.destroyed) return;
    const accountId = this.dependencies.chat.accountId();
    const nickname = this.nickname().trim() || accountId.split('@')[0] || 'operator';
    this.joiningRoom.set(roomJid);
    try {
      await this.dependencies.muc.join(accountId, roomJid, nickname);
      if (!this.destroyed && this.dependencies.isJoinedRoom(accountId, roomJid))
        this.dependencies.selectJoinedRoom(roomJid);
    } finally {
      if (!this.destroyed) this.joiningRoom.set(null);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.open.set(false);
    this.joiningRoom.set(null);
    this.discovering.set(false);
  }
}
