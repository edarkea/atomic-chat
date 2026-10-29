import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { XmppConnectionProfile, XmppTransport } from './core/domain';

@Component({
  selector: 'app-login-panel',
  imports: [FormsModule],
  templateUrl: './login-panel.component.html',
  styleUrls: ['./login-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPanelComponent {
  readonly accountId = input.required<string>();
  readonly domain = input('');
  readonly password = input.required<string>();
  readonly host = input('');
  readonly port = input(5222);
  readonly transport = input<XmppTransport>('starttls');
  readonly automatic = input(true);
  readonly remember = input(false);
  readonly autoLogin = input(false);
  readonly profiles = input<ReadonlyArray<XmppConnectionProfile>>([]);
  readonly selectedProfileId = input('');
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly accountIdChange = output<string>();
  readonly domainChange = output<string>();
  readonly passwordChange = output<string>();
  readonly hostChange = output<string>();
  readonly portChange = output<number>();
  readonly transportChange = output<XmppTransport>();
  readonly automaticChange = output<boolean>();
  readonly rememberChange = output<boolean>();
  readonly autoLoginChange = output<boolean>();
  readonly profileSelected = output<string>();
  readonly forgetSecret = output<void>();
  readonly deleteProfile = output<void>();
  readonly submitted = output<void>();

  protected canSubmit(): boolean {
    const account = this.accountId().trim();
    const at = account.indexOf('@');
    const localpart = at >= 0 ? account.slice(0, at) : account;
    const domain = at >= 0 ? account.slice(at + 1) : this.domain().trim();
    if (
      this.busy() ||
      !account ||
      !localpart ||
      !domain ||
      (at >= 0 && at !== account.lastIndexOf('@')) ||
      /[\s/@]/.test(localpart) ||
      /[\s/@]/.test(domain) ||
      (!this.password().trim() && !this.profiles().length)
    )
      return false;
    if (!this.automatic()) {
      const endpointPort = this.port();
      if (
        !this.host().trim() ||
        !Number.isInteger(endpointPort) ||
        endpointPort < 1 ||
        endpointPort > 65535 ||
        !['starttls', 'direct-tls'].includes(this.transport())
      )
        return false;
    }
    return true;
  }
}
