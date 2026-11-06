import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MucNotice, RoomMessage, RoomParticipant, RoomState } from './core/domain';
import { MessageComposerComponent } from './message-composer.component';
import { MessageItemComponent } from './message-item.component';
import { formatMessageDay } from './message-date-time';
import { groupMessagesForDisplay, MessageGroupingMetadata } from './message-grouping';

@Component({
  selector: 'app-muc-view',
  imports: [MessageComposerComponent, MessageItemComponent],
  templateUrl: './muc-view.component.html',
  styleUrls: ['./muc-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MucViewComponent {
  readonly roomState = input.required<RoomState>();
  readonly notices = input.required<ReadonlyArray<MucNotice>>();
  readonly participants = input.required<ReadonlyArray<RoomParticipant>>();
  readonly allParticipantCount = input.required<number>();
  readonly participantPage = input.required<number>();
  readonly hasMoreParticipants = input.required<boolean>();
  readonly messages = input.required<ReadonlyArray<RoomMessage>>();
  readonly draft = input.required<string>();

  readonly leave = output<void>();
  readonly closeRequested = output<void>();
  readonly previousParticipantPage = output<void>();
  readonly nextParticipantPage = output<void>();
  readonly draftChange = output<string>();
  readonly send = output<void>();

  protected readonly displayMessages = computed(() =>
    groupMessagesForDisplay(
      this.messages(),
      (message): MessageGroupingMetadata => ({
        senderKey: message.occupantJid.toLowerCase(),
        conversationKey: `${message.roomJid.toLowerCase()}|${message.sessionGeneration}`,
        createdAt: message.receivedAt,
      }),
      (message) => message.id,
      (message) => message.receivedAt,
    ),
  );

  protected isOutgoing(message: RoomMessage): boolean {
    const state = this.roomState();
    return (
      message.accountId === state.accountId &&
      message.roomJid === state.room.jid &&
      message.occupantJid === state.selfOccupantJid
    );
  }
  protected senderLabel(message: RoomMessage): string {
    const nickname = this.occupantNickname(message.occupantJid) || 'Participante desconocido';
    return this.isOutgoing(message) ? `Tú · ${nickname}` : nickname;
  }
  protected occupantNickname(occupantJid: string): string {
    const separator = occupantJid.indexOf('/');
    return separator >= 0 ? occupantJid.slice(separator + 1).trim() : '';
  }
  protected dayLabel(receivedAt: string): string { return formatMessageDay(receivedAt); }
}
