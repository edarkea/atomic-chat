import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
  ViewChild,
  ViewChildren,
  QueryList,
} from '@angular/core';
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
  readonly advancedSettings = output<void>();
  protected readonly profileMenuOpen = signal(false);
  private readonly profileOptionIndex = signal(0);
  @ViewChild('accountInput') private readonly accountInput?: ElementRef<HTMLInputElement>;
  @ViewChild('advancedButton') private readonly advancedButton?: ElementRef<HTMLButtonElement>;
  @ViewChild('profilePicker') private readonly profilePicker?: ElementRef<HTMLElement>;
  @ViewChildren('profileOption') private readonly profileOptions?: QueryList<
    ElementRef<HTMLButtonElement>
  >;

  private readonly rootElement = inject<ElementRef<HTMLElement>>(ElementRef);

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
      (!this.password().trim() &&
        !this.profiles().some(
          (profile) =>
            profile.accountId === this.selectedProfileId() &&
            profile.hasPersistentCredential === true,
        ))
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

  protected toggleProfileMenu(): void {
    if (!this.profiles().length) return;
    if (this.profileMenuOpen()) this.closeProfileMenu();
    else this.openProfileMenu();
  }

  protected selectProfile(accountId: string): void {
    this.profileSelected.emit(accountId);
    this.closeProfileMenu();
    queueMicrotask(() => this.accountInput?.nativeElement.focus());
  }

  protected onProfileTriggerKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'Enter', ' '].includes(event.key)) {
      if (event.key === 'Escape') this.closeProfileMenu();
      return;
    }
    event.preventDefault();
    if (!this.profileMenuOpen()) this.openProfileMenu();
    else this.focusProfileOption(event.key === 'ArrowDown' ? this.profileOptionIndex() : 0);
  }

  protected onProfileOptionKeydown(event: KeyboardEvent, index: number): void {
    const optionCount = this.profiles().length + 1;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      this.focusProfileOption((index + delta + optionCount) % optionCount);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.focusProfileOption(event.key === 'Home' ? 0 : optionCount - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.selectProfile(index === 0 ? '' : this.profiles()[index - 1].accountId);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeProfileMenu();
      queueMicrotask(() => this.accountInput?.nativeElement.focus());
    }
  }

  protected onProfileFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.profilePicker?.nativeElement.contains(next)) return;
    setTimeout(() => {
      if (!this.profilePicker?.nativeElement.contains(document.activeElement))
        this.closeProfileMenu();
    });
  }

  public focusAdvancedSettings(): void {
    this.advancedButton?.nativeElement.focus();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: PointerEvent): void {
    if (this.profileMenuOpen() && !this.rootElement.nativeElement.contains(event.target as Node))
      this.closeProfileMenu();
  }

  private openProfileMenu(): void {
    const selected = this.selectedProfileId();
    const index = selected
      ? Math.max(0, this.profiles().findIndex((profile) => profile.accountId === selected) + 1)
      : 0;
    this.profileOptionIndex.set(index);
    this.profileMenuOpen.set(true);
    this.focusProfileOption(index);
  }

  private closeProfileMenu(): void {
    this.profileMenuOpen.set(false);
  }

  private focusProfileOption(index: number): void {
    this.profileOptionIndex.set(index);
    queueMicrotask(() => this.profileOptions?.get(index)?.nativeElement.focus());
  }
}
