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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperatorPresenceComponent {
  readonly model = input.required<OperatorPresenceModel>();
  readonly presenceToggle = output<void>();
  readonly presenceSelected = output<PresenceOption>();
  readonly presenceStatusChange = output<string>();
  readonly settingsToggle = output<void>();
  readonly preferencesChange = output<Partial<Preferences>>();
  readonly resetPreferences = output<void>();
}
