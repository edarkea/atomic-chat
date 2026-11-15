import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { UserProfile, UserProfileUpdateInput } from '../../core/domain';
import { UserProfileImageComponent } from './user-profile-image.component';

interface UserProfileDraft {
  displayName: string;
  givenName: string;
  middleName: string;
  familyName: string;
  company: string;
  jobTitle: string;
  homeAddress: string;
  homeCity: string;
  homeState: string;
  homePostalCode: string;
  homeCountry: string;
  phone: string;
  mobile: string;
  fax: string;
  pager: string;
  birthday: string;
  description: string;
  website: string;
  nickname: string;
  email: string;
}

type UserProfileTab = 'personal' | 'business' | 'home' | 'avatar';

function draftFromProfile(profile: UserProfile | null): UserProfileDraft {
  return {
    displayName: profile?.displayName || '',
    givenName: profile?.givenName || '',
    middleName: profile?.middleName || '',
    familyName: profile?.familyName || '',
    company: profile?.company || '',
    jobTitle: profile?.jobTitle || '',
    homeAddress: profile?.homeAddress || '',
    homeCity: profile?.homeCity || '',
    homeState: profile?.homeState || '',
    homePostalCode: profile?.homePostalCode || '',
    homeCountry: profile?.homeCountry || '',
    phone: profile?.phone || '',
    mobile: profile?.mobile || '',
    fax: profile?.fax || '',
    pager: profile?.pager || '',
    birthday: profile?.birthday || '',
    description: profile?.description || '',
    website: profile?.website || '',
    nickname: profile?.nickname || '',
    email: profile?.email || '',
  };
}

@Component({
  selector: 'app-user-profile-dialog',
  imports: [FormsModule, UserProfileImageComponent],
  templateUrl: './user-profile-dialog.component.html',
  styleUrls: ['./user-profile-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserProfileDialogComponent {
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;

  readonly accountId = input.required<string>();
  readonly profile = input<UserProfile | null>(null);
  readonly loading = input(false);
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly saveRequested = output<UserProfileUpdateInput>();
  readonly avatarRequested = output<void>();
  readonly avatarClearRequested = output<void>();
  readonly cancelled = output<void>();

  protected readonly draft = signal<UserProfileDraft>(draftFromProfile(null));
  protected readonly dirty = signal(false);
  protected readonly activeTab = signal<UserProfileTab>('personal');
  protected readonly tabs: ReadonlyArray<{
    readonly id: UserProfileTab;
    readonly label: string;
  }> = [
    { id: 'personal', label: 'Personal' },
    { id: 'business', label: 'Negocio' },
    { id: 'home', label: 'Hogar' },
    { id: 'avatar', label: 'Avatar' },
  ];

  constructor() {
    effect(() => {
      const profile = this.profile();
      if (!this.dirty()) this.draft.set(draftFromProfile(profile));
      queueMicrotask(() => this.focusFirstControl());
    });
  }

  protected update(field: keyof UserProfileDraft, value: string): void {
    this.dirty.set(true);
    this.draft.update((current) => ({ ...current, [field]: value }));
  }

  protected selectTab(tab: UserProfileTab): void {
    this.activeTab.set(tab);
    queueMicrotask(() => this.focusFirstControl());
  }

  protected onTabKeydown(event: KeyboardEvent, tab: UserProfileTab): void {
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

  protected save(): void {
    const current = this.draft();
    this.saveRequested.emit({
      displayName: current.displayName.trim() || null,
      givenName: current.givenName.trim() || null,
      middleName: current.middleName.trim() || null,
      familyName: current.familyName.trim() || null,
      company: current.company.trim() || null,
      jobTitle: current.jobTitle.trim() || null,
      homeAddress: current.homeAddress.trim() || null,
      homeCity: current.homeCity.trim() || null,
      homeState: current.homeState.trim() || null,
      homePostalCode: current.homePostalCode.trim() || null,
      homeCountry: current.homeCountry.trim() || null,
      phone: current.phone.trim() || null,
      mobile: current.mobile.trim() || null,
      fax: current.fax.trim() || null,
      pager: current.pager.trim() || null,
      birthday: current.birthday.trim() || null,
      description: current.description.trim() || null,
      website: current.website.trim() || null,
      nickname: current.nickname.trim() || null,
      email: current.email.trim() || null,
    });
  }

  protected requestAvatar(): void {
    if (!this.loading() && !this.saving()) this.avatarRequested.emit();
  }

  protected clearAvatar(): void {
    if (!this.loading() && !this.saving()) this.avatarClearRequested.emit();
  }

  protected cancel(): void {
    if (!this.saving()) this.cancelled.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
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
    const activePanel =
      this.dialog?.nativeElement.querySelector<HTMLElement>('.user-profile-tab-panel');
    const field = activePanel?.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled])',
    );
    (field ?? this.focusableElements()[0])?.focus();
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(
      this.dialog?.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      ) ?? [],
    );
  }
}
