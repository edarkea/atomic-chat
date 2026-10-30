import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  output,
  inject,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PresenceOption } from './sidebar.models';

export interface OperatorPresenceModel {
  readonly accountId: string;
  readonly connectionLabel: string;
  readonly presenceLabel: string;
  readonly presenceDot: string;
  readonly presenceOpen: boolean;
  readonly presenceOptions: ReadonlyArray<PresenceOption>;
  readonly presenceOptionId: string;
  readonly presenceStatus: string;
}

@Component({
  selector: 'app-operator-presence',
  imports: [FormsModule],
  templateUrl: './operator-presence.component.html',
  styleUrls: ['./operator-presence.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperatorPresenceComponent {
  @ViewChild('presenceTrigger') private readonly presenceTrigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('presenceMenu') private readonly presenceMenu?: ElementRef<HTMLElement>;
  readonly model = input.required<OperatorPresenceModel>();
  readonly presenceToggle = output<void>();
  readonly presenceClose = output<void>();
  readonly presenceSelected = output<PresenceOption>();
  readonly presenceStatusChange = output<string>();
  private presenceWasOpen = false;

  constructor() {
    effect(() => {
      const isOpen = this.model().presenceOpen;
      if (isOpen && !this.presenceWasOpen) {
        queueMicrotask(() => this.focusSelectedOption());
      } else if (!isOpen && this.presenceWasOpen) {
        queueMicrotask(() => this.presenceTrigger?.nativeElement.focus());
      }
      this.presenceWasOpen = isOpen;
    });
  }

  protected selectPresence(option: PresenceOption): void {
    this.presenceSelected.emit(option);
  }
  protected optionTabIndex(option: PresenceOption): number {
    return this.model().presenceOptionId === option.id ? 0 : -1;
  }
  protected onTriggerKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!this.model().presenceOpen) this.presenceToggle.emit();
  }
  protected onMenuKeydown(event: KeyboardEvent): void {
    const options = Array.from(
      this.presenceMenu?.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ) ?? [],
    );
    const current = options.indexOf(event.currentTarget as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.presenceClose.emit();
      return;
    }
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = this.model().presenceOptions[current < 0 ? 0 : current];
      if (option) this.selectPresence(option);
    }
  }
  protected onStatusKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.presenceClose.emit();
  }
  private focusSelectedOption(): void {
    const options =
      this.presenceMenu?.nativeElement.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      );
    const selected = this.presenceMenu?.nativeElement.querySelector<HTMLButtonElement>(
      '[role="menuitemradio"][aria-checked="true"]',
    );
    (selected ?? options?.[0])?.focus();
  }
}
