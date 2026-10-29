import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Contact, Preferences } from './core/domain';
import { ConversationListComponent, ConversationListModel } from './conversation-list.component';
import { MucNavigationComponent, MucNavigationModel } from './muc-navigation.component';
import { OperatorPresenceComponent, OperatorPresenceModel } from './operator-presence.component';

export interface SidebarModel {
  readonly operator: OperatorPresenceModel;
  readonly muc: MucNavigationModel;
  readonly conversations: ConversationListModel;
}

@Component({
  selector: 'app-sidebar',
  imports: [ConversationListComponent, MucNavigationComponent, OperatorPresenceComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  readonly model = input.required<SidebarModel>();
  readonly presenceToggle = output<void>();
  readonly presenceClose = output<void>();
  readonly presenceSelected = output<OperatorPresenceModel['presenceOptions'][number]>();
  readonly presenceStatusChange = output<string>();
  readonly settingsToggle = output<void>();
  readonly preferencesChange = output<Partial<Preferences>>();
  readonly resetPreferences = output<void>();
  readonly nicknameChange = output<string>();
  readonly discoverRooms = output<void>();
  readonly selectRoom = output<string>();
  readonly joinRoom = output<string>();
  readonly leaveRoom = output<void>();
  readonly searchChange = output<string>();
  readonly useJid = output<void>();
  readonly selectContact = output<Contact>();
  readonly directoryToggle = output<void>();
  readonly refreshRoster = output<void>();
  readonly disconnect = output<void>();
}
