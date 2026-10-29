import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { XmppTransport } from './core/domain';

export interface ConnectionSettingsDraft {
  automatic: boolean;
  host: string;
  port: number;
  transport: XmppTransport;
}

@Component({
  selector: 'app-connection-settings-dialog',
  imports: [FormsModule],
  templateUrl: './connection-settings-dialog.component.html',
  styleUrls: ['./connection-settings-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionSettingsDialogComponent implements AfterViewInit, OnInit {
  readonly initial = input.required<ConnectionSettingsDraft>();
  readonly saving = input(false);
  readonly error = input<string | null>(null);
  readonly saved = output<ConnectionSettingsDraft>();
  readonly cancelled = output<void>();
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;
  protected readonly draft = signal<ConnectionSettingsDraft>({
    automatic: true,
    host: '',
    port: 5222,
    transport: 'starttls',
  });
  protected readonly validationError = signal<string | null>(null);

  ngOnInit(): void {
    this.draft.set({ ...this.initial() });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.firstFocusable()?.focus());
  }

  protected setAutomatic(automatic: boolean): void {
    this.updateDraft({ automatic });
  }

  protected setHost(host: string): void {
    this.updateDraft({ host });
  }

  protected setPort(port: number): void {
    this.updateDraft({ port });
  }

  protected setTransport(transport: XmppTransport): void {
    const current = this.draft();
    const port =
      current.transport === 'starttls' && transport === 'direct-tls' && current.port === 5222
        ? 5223
        : current.transport === 'direct-tls' && transport === 'starttls' && current.port === 5223
          ? 5222
          : current.port;
    this.updateDraft({ transport, port });
  }

  protected restoreDefaults(): void {
    this.draft.set({ automatic: true, host: '', port: 5222, transport: 'starttls' });
    this.validationError.set(null);
  }

  protected save(): void {
    const value = this.draft();
    if (!value.automatic && (!value.host.trim() || !Number.isInteger(value.port))) {
      this.validationError.set('Indica un host y un puerto entero entre 1 y 65535.');
      return;
    }
    if (!value.automatic && (value.port < 1 || value.port > 65535)) {
      this.validationError.set('El puerto debe estar entre 1 y 65535.');
      return;
    }
    this.validationError.set(null);
    this.saved.emit({ ...value, host: value.host.trim() });
  }

  protected cancel(): void {
    if (!this.saving()) this.cancelled.emit();
  }

  protected onDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = this.focusableElements();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancel();
  }

  protected onBackdropKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.cancel();
  }

  protected displayError(): string | null {
    return this.validationError() || this.error();
  }

  private updateDraft(changes: Partial<ConnectionSettingsDraft>): void {
    this.draft.update((current) => ({ ...current, ...changes }));
    this.validationError.set(null);
  }

  private firstFocusable(): HTMLElement | undefined {
    return this.focusableElements()[0];
  }

  private focusableElements(): HTMLElement[] {
    return this.dialog
      ? Array.from(
          this.dialog.nativeElement.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled])',
          ),
        )
      : [];
  }
}
