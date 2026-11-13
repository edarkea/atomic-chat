import { computed, signal, type Signal } from '@angular/core';
import type { ConnectionState, Presence, RoomRef, RoomState } from '../../core/domain';
import type { MucNavigationModel } from './muc-navigation.component';
import type { ConversationListModel } from './conversation-list.component';
import type { OperatorPresenceModel } from './operator-presence.component';
import type { SidebarModel } from './sidebar.component';
import type { PresenceOption } from './sidebar.models';
import type { Contact } from '../../core/domain';
import type { WorkspaceConversationItem } from './conversation-list.component';

export interface SidebarViewInputs {
  readonly connection: Signal<ConnectionState>;
  readonly accountId: Signal<string>;
  readonly presence: Signal<Presence>;
  readonly search: Signal<string>;
  readonly unreadCounts: Signal<ReadonlyMap<string, number>> | undefined;
  readonly nickname: Signal<string>;
  readonly discovering: Signal<boolean>;
  readonly mucError: Signal<string | null>;
  readonly services: Signal<ReadonlyArray<RoomRef>>;
  readonly mucStates: Signal<ReadonlyArray<RoomState>>;
  readonly selectedRoomJid: Signal<string>;
  readonly activeRoomState: Signal<RoomState | undefined>;
  readonly joinedRooms: Signal<ReadonlyArray<RoomState>>;
  readonly filteredContacts: Signal<ReadonlyArray<Contact>>;
  readonly workspaceContacts: Signal<ReadonlyArray<Contact> | undefined>;
  readonly workspaceItems: Signal<ReadonlyArray<WorkspaceConversationItem> | undefined>;
  readonly selectedJid: Signal<string>;
}

export class SidebarViewCoordinator {
  readonly presenceOpen = signal(false);
  readonly presenceStatus = signal('');
  readonly presenceOptions: ReadonlyArray<PresenceOption> = [
    { id: 'chat', mode: 'chat', label: 'Libre para chatear', dot: 'chat' },
    { id: 'online', mode: undefined, label: 'En línea', dot: 'online' },
    { id: 'away', mode: 'away', label: 'Ausente', dot: 'away' },
    { id: 'phone', mode: 'away', label: 'Al teléfono', dot: 'phone' },
    { id: 'xa', mode: 'xa', label: 'Ausencia extendida', dot: 'xa' },
    { id: 'dnd', mode: 'dnd', label: 'No molestar', dot: 'dnd' },
  ];

  readonly selectedPresenceOption = computed<PresenceOption>(() => {
    const current = this.inputs.presence();
    return (
      this.presenceOptions.find(
        (option) =>
          option.mode === current.mode &&
          (option.id !== 'phone' || current.status === 'Al teléfono') &&
          (option.id !== 'away' || current.status !== 'Al teléfono'),
      ) || this.presenceOptions[1]
    );
  });

  readonly connectionLabel = computed(() => {
    const labels: Record<ConnectionState['status'], string> = {
      idle: 'Desconectado',
      connecting: 'Conectando',
      authenticating: 'Autenticando',
      connected: 'Conectado',
      disconnecting: 'Desconectando',
      failed: 'Falló',
    };
    return labels[this.inputs.connection().status];
  });

  readonly presenceLabel = computed(() => this.selectedPresenceOption().label);
  readonly presenceDot = computed(() => this.selectedPresenceOption().dot);
  private readonly filteredServices = computed(() => {
    const term = this.inputs.search().trim().toLowerCase();
    return this.inputs
      .services()
      .filter(
        (room) =>
          !term ||
          room.jid.toLowerCase().includes(term) ||
          room.room.toLowerCase().includes(term) ||
          room.service.toLowerCase().includes(term),
      );
  });

  readonly model = computed<SidebarModel>(() => {
    const muc: MucNavigationModel = {
      nickname: this.inputs.nickname(),
      discovering: this.inputs.discovering(),
      error: this.inputs.mucError(),
      services: this.filteredServices(),
      states: this.inputs.mucStates(),
      selectedRoomJid: this.inputs.selectedRoomJid(),
      activeRoomState: this.inputs.activeRoomState(),
    };
    const conversations: ConversationListModel = {
      search: this.inputs.search(),
      accountId: this.inputs.accountId(),
      joinedRooms: this.inputs.joinedRooms(),
      filteredContacts: this.inputs.filteredContacts(),
      workspaceContacts: this.inputs.workspaceContacts(),
      workspaceItems: this.inputs.workspaceItems(),
      muc,
      unreadCounts: this.inputs.unreadCounts?.() ?? new Map(),
      selectedJid: this.inputs.selectedJid(),
      selectedRoomJid: this.inputs.selectedRoomJid(),
    };
    const operator: OperatorPresenceModel = {
      displayName: this.inputs.connection().displayName,
      accountId: this.inputs.accountId(),
      connectionLabel: this.connectionLabel(),
      presenceLabel: this.presenceLabel(),
      presenceDot: this.presenceDot(),
      presenceOpen: this.presenceOpen(),
      presenceOptions: this.presenceOptions,
      presenceOptionId: this.selectedPresenceOption().id,
      presenceStatus: this.presenceStatus(),
    };
    return { operator, muc, conversations };
  });

  constructor(private readonly inputs: SidebarViewInputs) {}
}
