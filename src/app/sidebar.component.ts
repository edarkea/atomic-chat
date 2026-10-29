import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Contact, MucRole, PresenceMode, Preferences, RoomRef, RoomState } from './core/domain';

export interface PresenceOption {
  readonly id: string;
  readonly mode: PresenceMode | undefined;
  readonly label: string;
  readonly dot: string;
}

@Component({
  selector: 'app-sidebar',
  imports: [FormsModule],
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  readonly accountId = input.required<string>();
  readonly connectionLabel = input.required<string>();
  readonly presenceLabel = input.required<string>();
  readonly presenceDot = input.required<string>();
  readonly presenceOpen = input.required<boolean>();
  readonly presenceOptions = input.required<ReadonlyArray<PresenceOption>>();
  readonly presenceStatus = input.required<string>();
  readonly settingsOpen = input.required<boolean>();
  readonly preferences = input.required<Preferences>();
  readonly search = input.required<string>();
  readonly mucNickname = input.required<string>();
  readonly mucDiscovering = input.required<boolean>();
  readonly mucError = input<string | null>(null);
  readonly mucServices = input.required<ReadonlyArray<RoomRef>>();
  readonly mucStates = input.required<ReadonlyArray<RoomState>>();
  readonly selectedRoomJid = input.required<string>();
  readonly joinedRooms = input.required<ReadonlyArray<RoomState>>();
  readonly filteredContacts = input.required<ReadonlyArray<Contact>>();
  readonly selectedJid = input.required<string>();
  readonly activeRoomState = input<RoomState>();

  readonly togglePresence = output<void>();
  readonly presenceSelected = output<PresenceOption>();
  readonly presenceStatusChange = output<string>();
  readonly toggleSettings = output<void>();
  readonly preferencesChange = output<Partial<Preferences>>();
  readonly resetPreferences = output<void>();
  readonly searchChange = output<string>();
  readonly useJid = output<void>();
  readonly mucNicknameChange = output<string>();
  readonly discoverRooms = output<void>();
  readonly selectRoom = output<string>();
  readonly joinRoom = output<string>();
  readonly leaveRoom = output<void>();
  readonly selectJoinedRoom = output<string>();
  readonly selectContact = output<Contact>();
  readonly refreshRoster = output<void>();
  readonly disconnect = output<void>();

  protected isPresenceSelected(id: string): boolean {
    return (
      this.presenceOptions().find((option) => option.id === id)?.id === id &&
      this.presenceLabel() === this.presenceOptions().find((option) => option.id === id)?.label
    );
  }
  protected contactName(contact: Contact): string {
    return contact.name?.trim() || contact.jid;
  }
  protected contactGroups(contact: Contact): string[] {
    return [...new Set((contact.groups || []).map((group) => group.trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    );
  }
  protected contactKind(contact: Contact): string {
    return contact.source === 'conversation'
      ? 'Conversación local'
      : this.contactGroups(contact).length
        ? this.contactGroups(contact).join(' · ')
        : 'Sin grupo';
  }
  protected remotePresenceLabel(contact: Contact): string {
    const presence = contact.presence;
    if (!presence) return 'Estado desconocido';
    if (presence.availability === 'unavailable') return 'No disponible';
    return (
      (
        {
          chat: 'Libre para chatear',
          away: 'Ausente',
          xa: 'Ausencia extendida',
          dnd: 'No molestar',
        } as Record<string, string>
      )[presence.mode || ''] || 'En línea'
    );
  }
  protected remotePresenceDot(contact: Contact): string {
    const presence = contact.presence;
    if (!presence || presence.availability === 'unavailable') return 'unknown';
    return presence.mode || 'online';
  }
  protected roomStatus(roomJid: string): string {
    return this.mucStates().find((state) => state.room.jid === roomJid)?.status || 'idle';
  }
  protected isDirectSelected(jid: string): boolean {
    return this.selectedJid().split('/')[0].toLowerCase() === jid.split('/')[0].toLowerCase();
  }
  protected isRoomSelected(roomJid: string): boolean {
    return this.selectedRoomJid() === roomJid;
  }
  protected participantSummary(state: RoomState): string {
    return `Sala MUC · ${state.participants.length} participantes`;
  }
  protected roleLabel(role: MucRole): string {
    return role;
  }
}
