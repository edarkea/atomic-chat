import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MucNotice, RoomMessage, RoomParticipant, RoomState } from './core/domain';
import { MessageComposerComponent } from './message-composer.component';
import { MessageItemComponent } from './message-item.component';

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
  readonly previousParticipantPage = output<void>();
  readonly nextParticipantPage = output<void>();
  readonly draftChange = output<string>();
  readonly send = output<void>();

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
}
