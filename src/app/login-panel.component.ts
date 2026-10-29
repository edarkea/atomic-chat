import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-login-panel',
  imports: [FormsModule],
  templateUrl: './login-panel.component.html',
  styleUrls: ['./login-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPanelComponent {
  readonly accountId = input.required<string>();
  readonly password = input.required<string>();
  readonly error = input<string | null>(null);
  readonly accountIdChange = output<string>();
  readonly passwordChange = output<string>();
  readonly submitted = output<void>();
}
