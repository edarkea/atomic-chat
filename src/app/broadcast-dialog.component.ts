import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BroadcastMode, BroadcastRecipientResult, Contact } from './core/domain';
import { bareBroadcastJid } from './core/broadcast.facade';

export interface BroadcastDialogModel {
  readonly contacts: ReadonlyArray<Contact>;
  readonly groups: ReadonlyArray<string>;
  readonly selectedJids: ReadonlySet<string>;
  readonly body: string;
  readonly mode: BroadcastMode;
  readonly hideOffline: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly result: ReadonlyArray<BroadcastRecipientResult> | null;
}

@Component({
  selector: 'app-broadcast-dialog',
  imports: [FormsModule],
  templateUrl: './broadcast-dialog.component.html',
  styleUrls: ['./broadcast-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BroadcastDialogComponent {
  @ViewChild('dialog') private readonly dialog?: ElementRef<HTMLElement>;

  readonly model = input.required<BroadcastDialogModel>();
  readonly bodyChange = output<string>();
  readonly modeChange = output<BroadcastMode>();
  readonly hideOfflineChange = output<boolean>();
  readonly toggleContact = output<string>();
  readonly toggleGroup = output<string>();
  readonly toggleAll = output<void>();
  readonly submit = output<void>();
  readonly cancelled = output<void>();
  readonly retryFailed = output<void>();
  private initialFocusScheduled = false;

  constructor() {
    effect(() => {
      this.model();
      if (this.initialFocusScheduled) return;
      this.initialFocusScheduled = true;
      queueMicrotask(() => this.focusFirstControl());
    });
  }

  protected contactName(contact: Contact): string {
    return contact.name?.trim() || contact.jid;
  }

  protected jid(contact: Contact): string {
    return bareBroadcastJid(contact.jid);
  }

  protected isSelected(contact: Contact): boolean {
    return this.model().selectedJids.has(this.jid(contact));
  }

  protected isOnline(contact: Contact): boolean {
    const availability = contact.presence?.availability;
    return (
      availability !== undefined && availability !== 'unknown' && availability !== 'unavailable'
    );
  }

  protected presenceLabel(contact: Contact): string {
    return this.isOnline(contact) ? 'Conectado' : 'Desconectado';
  }

  protected onHideOfflineChange(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.hideOfflineChange.emit(input.checked);
  }

  protected groupContacts(group: string): ReadonlyArray<Contact> {
    return this.model().contacts.filter((contact) => contact.groups.includes(group));
  }

  protected groupSelected(group: string): boolean {
    const contacts = this.groupContacts(group);
    return contacts.length > 0 && contacts.every((contact) => this.isSelected(contact));
  }

  protected groupPartial(group: string): boolean {
    const contacts = this.groupContacts(group);
    return contacts.some((contact) => this.isSelected(contact)) && !this.groupSelected(group);
  }

  protected submittedCount(): number {
    return this.model().result?.filter((item) => item.status === 'submitted').length || 0;
  }

  protected failedCount(): number {
    return (
      this.model().result?.filter((item) => item.status === 'failed' || item.status === 'unknown')
        .length || 0
    );
  }

  protected retryableCount(): number {
    return this.model().result?.filter((item) => item.status === 'failed').length || 0;
  }

  protected statusLabel(status: BroadcastRecipientResult['status']): string {
    return {
      queued: 'En cola',
      submitted: 'Enviado',
      failed: 'Falló',
      unknown: 'Resultado incierto',
    }[status];
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.model().busy) this.cancelled.emit();
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

  private focusableElements(): Array<HTMLElement> {
    return Array.from(
      this.dialog?.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      ) ?? [],
    );
  }
}
