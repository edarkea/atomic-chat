import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  ViewChild,
} from '@angular/core';
import type { Contact, UserProfile } from '../../core/domain';
import { UserProfileImageComponent } from '../session/user-profile-image.component';

@Component({
  selector: 'app-contact-profile-summary-dialog',
  imports: [UserProfileImageComponent],
  templateUrl: './contact-profile-summary-dialog.component.html',
  styleUrls: ['./contact-profile-summary-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactProfileSummaryDialogComponent {
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;

  readonly contact = input<Contact>();
  readonly profile = input.required<UserProfile>();
  readonly viewProfileRequested = output<void>();
  readonly cancelled = output<void>();

  protected readonly title = computed(
    () => this.contact()?.name?.trim() || this.profile().displayName?.trim() || this.profile().jid,
  );
  protected readonly rosterName = computed(() => this.contact()?.name?.trim() || '');

  protected viewProfile(): void {
    this.viewProfileRequested.emit();
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

  protected focusFirstControl(): void {
    this.dialog?.nativeElement.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }

  private focusableElements(): HTMLElement[] {
    return Array.from(
      this.dialog?.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
    );
  }
}
