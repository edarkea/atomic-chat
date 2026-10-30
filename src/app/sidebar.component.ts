import { ChangeDetectionStrategy, Component, input, output, ViewChild } from '@angular/core';
import { Contact } from './core/domain';
import { ConversationListComponent, ConversationListModel } from './conversation-list.component';
import { MucNavigationModel } from './muc-navigation.component';
import { OperatorPresenceComponent, OperatorPresenceModel } from './operator-presence.component';

export interface SidebarModel {
  readonly operator: OperatorPresenceModel;
  readonly muc: MucNavigationModel;
  readonly conversations: ConversationListModel;
}

@Component({
  selector: 'app-sidebar',
  imports: [ConversationListComponent, OperatorPresenceComponent],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss'],
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  @ViewChild(ConversationListComponent)
  private readonly conversationList?: ConversationListComponent;
  readonly model = input.required<SidebarModel>();
  readonly presenceToggle = output<void>();
  readonly presenceClose = output<void>();
  readonly presenceSelected = output<OperatorPresenceModel['presenceOptions'][number]>();
  readonly presenceStatusChange = output<string>();
  readonly nicknameChange = output<string>();
  readonly discoverRooms = output<void>();
  readonly selectRoom = output<string>();
  readonly joinRoom = output<string>();
  readonly leaveRoom = output<void>();
  readonly searchChange = output<string>();
  readonly useJid = output<void>();
  readonly selectContact = output<Contact>();
  readonly newMessageToggle = output<void>();
  readonly preferencesToggle = output<void>();
  readonly refreshRoster = output<void>();
  readonly disconnect = output<void>();

  focusNewMessageTrigger(): void {
    this.conversationList?.focusNewMessageTrigger();
  }

  focusPreferencesTrigger(): void {
    this.conversationList?.focusPreferencesTrigger();
  }
}
