import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import type { Contact, UserProfile } from '../../core/domain';
import { UserProfileImageComponent } from '../session/user-profile-image.component';

type ContactProfileTab = 'personal' | 'business' | 'home';

@Component({
  selector: 'app-contact-profile-dialog',
  imports: [UserProfileImageComponent],
  templateUrl: './contact-profile-dialog.component.html',
  styleUrls: ['./contact-profile-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactProfileDialogComponent {
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;

  readonly contact = input<Contact>();
  readonly profile = input.required<UserProfile>();
  readonly cancelled = output<void>();

  protected readonly activeTab = signal<ContactProfileTab>('personal');
  protected readonly tabs: ReadonlyArray<{
    readonly id: ContactProfileTab;
    readonly label: string;
  }> = [
    { id: 'personal', label: 'Personal' },
    { id: 'business', label: 'Negocio' },
    { id: 'home', label: 'Hogar' },
  ];
  protected readonly title = computed(
    () => this.contact()?.name?.trim() || this.profile().displayName?.trim() || this.profile().jid,
  );
  protected readonly rosterName = computed(() => this.contact()?.name?.trim() || '');
  protected readonly fullName = computed(() =>
    [this.profile().givenName, this.profile().middleName, this.profile().familyName]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .join(' '),
  );

  protected selectTab(tab: ContactProfileTab): void {
    this.activeTab.set(tab);
    queueMicrotask(() => this.focusFirstControl());
  }

  protected onTabKeydown(event: KeyboardEvent, tab: ContactProfileTab): void {
    const index = this.tabs.findIndex((item) => item.id === tab);
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % this.tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + this.tabs.length) % this.tabs.length
          : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    this.selectTab(this.tabs[nextIndex].id);
  }

  protected close(): void {
    this.cancelled.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
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

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  private focusFirstControl(): void {
    this.dialog?.nativeElement.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(
      this.dialog?.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
    );
  }
}
