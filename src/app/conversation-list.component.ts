import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Contact, RoomState } from './core/domain';

export interface ConversationListModel {
  readonly search: string;
  readonly joinedRooms: ReadonlyArray<RoomState>;
  readonly filteredContacts: ReadonlyArray<Contact>;
  readonly selectedJid: string;
  readonly selectedRoomJid: string;
}

@Component({
  selector: 'app-conversation-list',
  imports: [FormsModule],
  templateUrl: './conversation-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationListComponent {
  readonly model = input.required<ConversationListModel>();
  readonly searchChange = output<string>();
  readonly useJid = output<void>();
  readonly selectRoom = output<string>();
  readonly selectContact = output<Contact>();
  readonly refreshRoster = output<void>();
  readonly disconnect = output<void>();

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
  protected isDirectSelected(jid: string): boolean {
    return this.model().selectedJid.split('/')[0].toLowerCase() === jid.split('/')[0].toLowerCase();
  }
  protected isRoomSelected(roomJid: string): boolean {
    return this.model().selectedRoomJid === roomJid;
  }
}
