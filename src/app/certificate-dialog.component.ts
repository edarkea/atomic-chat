import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  ViewChild,
} from '@angular/core';
import { CertificateTrustDecision, CertificateTrustRequest } from './core/domain';

@Component({
  selector: 'app-certificate-dialog',
  templateUrl: './certificate-dialog.component.html',
})
export class CertificateDialogComponent {
  readonly request = input.required<CertificateTrustRequest>();
  readonly decision = output<CertificateTrustDecision>();

  @ViewChild('certificateDialog') private certificateDialog?: ElementRef<HTMLElement>;
  private certificateWasOpen = false;
  private certificateReturnFocus?: HTMLElement;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const request = this.request();
      if (!this.certificateWasOpen) {
        this.certificateWasOpen = true;
        const active = document.activeElement;
        this.certificateReturnFocus = active instanceof HTMLElement ? active : undefined;
        queueMicrotask(() => {
          const dialog = this.certificateDialog?.nativeElement;
          dialog?.focus();
          dialog?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
        });
      }
      if (!request) this.certificateWasOpen = false;
    });
    this.destroyRef.onDestroy(() => {
      const returnFocus = this.certificateReturnFocus;
      this.certificateReturnFocus = undefined;
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const dialog = this.certificateDialog?.nativeElement;
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.decision.emit('cancel');
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute('hidden') && element.getClientRects().length > 0);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
