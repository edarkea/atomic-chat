import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Contact, RoomRef, RoomState } from './core/domain';

export interface NewMessageDialogModel {
  readonly search: string;
  readonly contacts: ReadonlyArray<Contact>;
  readonly joinedRooms: ReadonlyArray<RoomState>;
  readonly services: ReadonlyArray<RoomRef>;
  readonly nickname: string;
  readonly discovering: boolean;
  readonly joiningRoomJid: string | null;
  readonly error: string | null;
}

@Component({
  selector: 'app-new-message-dialog',
  imports: [FormsModule],
  templateUrl: './new-message-dialog.component.html',
  styleUrls: ['./new-message-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewMessageDialogComponent {
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;

  readonly model = input.required<NewMessageDialogModel>();
  readonly searchChange = output<string>();
  readonly selectContact = output<Contact>();
  readonly useJid = output<void>();
  readonly selectJoinedRoom = output<string>();
  readonly discoverRooms = output<void>();
  readonly joinRoom = output<string>();
  readonly nicknameChange = output<string>();
  readonly cancelled = output<void>();
  private initialFocusScheduled = false;

  constructor() {
    effect(() => {
      this.model();
      if (this.initialFocusScheduled) return;
      this.initialFocusScheduled = true;
      queueMicrotask(() => this.focusFirstControl());
    });
  }

  protected contactName(contact: Contact): string {
    return contact.name?.trim() || contact.jid;
  }

  protected isJoining(roomJid: string): boolean {
    return this.model().joiningRoomJid === roomJid;
  }

  protected isJoined(roomJid: string): boolean {
    return this.model().joinedRooms.some((room) => room.room.jid === roomJid);
  }

  protected roomStatus(roomJid: string): string {
    return (
      this.model().joinedRooms.find((room) => room.room.jid === roomJid)?.status || 'disponible'
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = this.focusableElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusFirstControl(): void {
    this.focusableElements()[0]?.focus();
  }

  private focusableElements(): Array<HTMLButtonElement | HTMLInputElement> {
    return Array.from(
      this.dialog?.nativeElement.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button:not([disabled]), input:not([disabled])',
      ) ?? [],
    ).filter(
      (element): element is HTMLButtonElement | HTMLInputElement =>
        element instanceof HTMLButtonElement || element instanceof HTMLInputElement,
    );
  }
}
