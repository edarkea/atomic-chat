import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ThemeColorKey } from './core/domain';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-theme-studio',
  imports: [FormsModule],
  templateUrl: './theme-studio.component.html',
  styleUrls: ['./theme-studio.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeStudioComponent {
  protected readonly theme = inject(ThemeService);
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;

  constructor() {
    effect(() => {
      if (!this.theme.editorOpen()) return;
      queueMicrotask(() => this.focusFirstControl());
    });
  }

  protected color(key: ThemeColorKey): string {
    return this.theme.draftPalette()[key];
  }

  protected changeColor(key: ThemeColorKey, event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.theme.setDraftColor(key, input.value);
  }

  protected apply(): void {
    void this.theme.applyDraft();
  }

  protected cancel(): void {
    this.theme.cancelStudio();
  }

  protected restoreOriginal(): void {
    void this.theme.restoreOriginal();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
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
    this.focusableElements()[0]?.focus();
  }

  private focusableElements(): Array<HTMLButtonElement | HTMLInputElement> {
    return Array.from(
      this.dialog?.nativeElement.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button:not([disabled]), input:not([disabled])',
      ) ?? [],
    ).filter(
      (element): element is HTMLButtonElement | HTMLInputElement =>
        element instanceof HTMLButtonElement || element instanceof HTMLInputElement,
    );
  }
}
