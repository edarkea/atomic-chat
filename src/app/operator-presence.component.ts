import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Preferences } from './core/domain';
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
  readonly settingsOpen: boolean;
  readonly preferences: Preferences;
}

@Component({
  selector: 'app-operator-presence',
  imports: [FormsModule],
  templateUrl: './operator-presence.component.html',
  styleUrls: ['./operator-presence.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperatorPresenceComponent {
  readonly model = input.required<OperatorPresenceModel>();
  readonly presenceToggle = output<void>();
  readonly presenceClose = output<void>();
  readonly presenceSelected = output<PresenceOption>();
  readonly presenceStatusChange = output<string>();
  readonly settingsToggle = output<void>();
  readonly preferencesChange = output<Partial<Preferences>>();
  readonly resetPreferences = output<void>();

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
    queueMicrotask(() => this.focusFirstOption());
  }
  protected onMenuKeydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) return;
    const options = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ),
    );
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
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
  private focusFirstOption(): void {
    document.querySelector<HTMLElement>('.presence-menu [role="menuitemradio"]')?.focus();
  }
}
