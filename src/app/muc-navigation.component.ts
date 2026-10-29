import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RoomRef, RoomState } from './core/domain';

export interface MucNavigationModel {
  readonly nickname: string;
  readonly discovering: boolean;
  readonly error: string | null;
  readonly services: ReadonlyArray<RoomRef>;
  readonly states: ReadonlyArray<RoomState>;
  readonly selectedRoomJid: string;
  readonly activeRoomState: RoomState | undefined;
}

@Component({
  selector: 'app-muc-navigation',
  imports: [FormsModule],
  templateUrl: './muc-navigation.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MucNavigationComponent {
  readonly model = input.required<MucNavigationModel>();
  readonly nicknameChange = output<string>();
  readonly discover = output<void>();
  readonly selectRoom = output<string>();
  readonly joinRoom = output<string>();
  readonly leaveRoom = output<void>();

  protected roomStatus(roomJid: string): string {
    return this.model().states.find((state) => state.room.jid === roomJid)?.status || 'idle';
  }
  protected isSelected(roomJid: string): boolean {
    return this.model().selectedRoomJid === roomJid;
  }
}
