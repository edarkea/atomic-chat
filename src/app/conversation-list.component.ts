import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Contact, RoomState } from './core/domain';
import { MucNavigationComponent, MucNavigationModel } from './muc-navigation.component';

export type WorkspaceConversationItem =
  | { readonly kind: 'direct'; readonly contact: Contact; readonly lastActivity: number }
  | { readonly kind: 'muc'; readonly roomState: RoomState; readonly lastActivity: number };

export interface ConversationListModel {
  readonly accountId?: string;
  readonly search: string;
  readonly joinedRooms: ReadonlyArray<RoomState>;
  readonly filteredContacts: ReadonlyArray<Contact>;
  readonly workspaceContacts?: ReadonlyArray<Contact>;
  readonly directoryOpen?: boolean;
  readonly unreadCounts?: ReadonlyMap<string, number>;
  readonly workspaceItems?: ReadonlyArray<WorkspaceConversationItem>;
  readonly muc?: MucNavigationModel;
  readonly selectedJid: string;
  readonly selectedRoomJid: string;
}

@Component({
  selector: 'app-conversation-list',
  imports: [FormsModule, MucNavigationComponent],
  templateUrl: './conversation-list.component.html',
  styleUrls: ['./conversation-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationListComponent {
  readonly model = input.required<ConversationListModel>();
  readonly searchChange = output<string>();
  readonly useJid = output<void>();
  readonly selectRoom = output<string>();
  readonly selectContact = output<Contact>();
  readonly directoryToggle = output<void>();
  readonly nicknameChange = output<string>();
  readonly discoverRooms = output<void>();
  readonly joinRoom = output<string>();
  readonly leaveRoom = output<void>();
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
    if (presence.availability === 'unknown') return 'Estado desconocido';
    if (presence.availability === 'unavailable') return 'No disponible';
    if (presence.availability === 'away') return 'Ausente';
    if (presence.availability === 'extended-away') return 'Ausencia extendida';
    if (presence.availability === 'dnd') return 'No molestar';
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
    return presence.availability === 'available' ? presence.mode || 'online' : presence.availability;
  }
  protected unreadCount(kind: 'direct' | 'muc', jid: string): number {
    const model = this.model();
    return model.unreadCounts?.get(
      `${model.accountId?.toLowerCase() || ''}|${kind}|${jid.split('/')[0].toLowerCase()}`,
    ) || 0;
  }
  protected isDirectSelected(jid: string): boolean {
    return this.model().selectedJid.split('/')[0].toLowerCase() === jid.split('/')[0].toLowerCase();
  }
  protected isRoomSelected(roomJid: string): boolean {
    return this.model().selectedRoomJid === roomJid;
  }
}
