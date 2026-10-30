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
import { Preferences } from './core/domain';
import { isThemeId, THEME_OPTIONS, ThemeService } from './core/theme.service';
import { ThemeStudioComponent } from './theme-studio.component';

export type PreferencesTab =
  'general' | 'appearance' | 'conversations' | 'notifications' | 'transfers';
export type PreferencesSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface PreferencesDialogModel {
  readonly preferences: Preferences;
  readonly downloadDirectorySelecting: boolean;
  readonly saveState: PreferencesSaveState;
  readonly error: string | null;
}

@Component({
  selector: 'app-preferences-dialog',
  imports: [FormsModule, ThemeStudioComponent],
  templateUrl: './preferences-dialog.component.html',
  styleUrls: ['./preferences-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PreferencesDialogComponent {
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;
  @ViewChild('themeStudioTrigger')
  private readonly themeStudioTrigger?: ElementRef<HTMLButtonElement>;

  protected readonly theme: ThemeService;
  protected readonly themeOptions = THEME_OPTIONS;
  protected readonly tabs: ReadonlyArray<{ readonly id: PreferencesTab; readonly label: string }> =
    [
      { id: 'general', label: 'General' },
      { id: 'appearance', label: 'Apariencia' },
      { id: 'conversations', label: 'Conversaciones' },
      { id: 'notifications', label: 'Notificaciones' },
      { id: 'transfers', label: 'Transferencias' },
    ];
  protected readonly activeTab = signal<PreferencesTab>('general');
  readonly model = input.required<PreferencesDialogModel>();
  readonly preferenceChange = output<Partial<Preferences>>();
  readonly selectDownloadDirectory = output<void>();
  readonly reset = output<void>();
  readonly cancelled = output<void>();

  private readonly themeService: ThemeService;
  private studioWasOpen = false;
  private initialFocusScheduled = false;

  constructor(themeService: ThemeService) {
    this.themeService = themeService;
    this.theme = themeService;
    effect(() => {
      this.model();
      if (!this.initialFocusScheduled) {
        this.initialFocusScheduled = true;
        queueMicrotask(() => this.focusFirstControl());
      }
    });
    effect(() => {
      const studioOpen = this.themeService.editorOpen();
      if (!studioOpen && this.studioWasOpen)
        queueMicrotask(() => this.themeStudioTrigger?.nativeElement.focus());
      this.studioWasOpen = studioOpen;
    });
  }

  protected selectTab(tab: PreferencesTab): void {
    this.activeTab.set(tab);
  }

  protected onTabKeydown(event: KeyboardEvent, tab: PreferencesTab): void {
    const tabs: PreferencesTab[] = [
      'general',
      'appearance',
      'conversations',
      'notifications',
      'transfers',
    ];
    const current = tabs.indexOf(tab);
    if (
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp'
    ) {
      event.preventDefault();
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      this.activeTab.set(tabs[(current + direction + tabs.length) % tabs.length]);
      queueMicrotask(() => this.focusTab(tabs[(current + direction + tabs.length) % tabs.length]));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? tabs[0] : tabs.at(-1)!;
      this.activeTab.set(next);
      queueMicrotask(() => this.focusTab(next));
    }
  }

  protected async selectTheme(value: string): Promise<void> {
    if (isThemeId(value)) await this.themeService.selectTheme(value);
  }

  protected setTransferTimeout(value: string): void {
    const seconds = Number(value);
    if (seconds === 60 || seconds === 180 || seconds === 300 || seconds === 600)
      this.preferenceChange.emit({ fileTransferTimeoutSeconds: seconds });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.cancelled.emit();
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

  private focusTab(tab: PreferencesTab): void {
    this.dialog?.nativeElement
      .querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${tab}"]`)
      ?.focus();
  }

  private focusableElements(): Array<HTMLButtonElement | HTMLInputElement | HTMLSelectElement> {
    return Array.from(
      this.dialog?.nativeElement.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [],
    );
  }
}
