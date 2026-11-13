import { computed, signal } from '@angular/core';
import type {
  BroadcastMode,
  BroadcastRecipientResult,
  BroadcastRequest,
  BroadcastResult,
  Contact,
} from '../domain';
import { bareBroadcastJid } from '../facades/broadcast.facade';
import { createOpaqueId } from '../ids';

export interface BroadcastSender {
  send(request: BroadcastRequest): Promise<BroadcastResult>;
}

export interface BroadcastCoordinatorDependencies {
  readonly sender: BroadcastSender;
  readonly accountId: () => string;
  readonly isConnected: () => boolean;
  readonly contacts: () => ReadonlyArray<Contact>;
}

export interface BroadcastAttempt {
  readonly mode: BroadcastMode;
  readonly body: string;
}

export interface BroadcastDialogViewModel {
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

export class BroadcastCoordinator {
  readonly open = signal(false);
  readonly body = signal('');
  readonly mode = signal<BroadcastMode>('normal');
  readonly hideOffline = signal(false);
  readonly selectedJids = signal<ReadonlySet<string>>(new Set<string>());
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<ReadonlyArray<BroadcastRecipientResult> | null>(null);
  readonly dialogModel = computed<BroadcastDialogViewModel>(() => ({
    contacts: this.contacts(),
    groups: this.groups(),
    selectedJids: this.selectedJids(),
    body: this.body(),
    mode: this.mode(),
    hideOffline: this.hideOffline(),
    busy: this.busy(),
    error: this.error(),
    result: this.result(),
  }));

  readonly contacts = computed<ReadonlyArray<Contact>>(() => {
    const accountJid = bareBroadcastJid(this.dependencies.accountId());
    const contactsByJid = new Map<string, Contact>();
    for (const contact of this.dependencies.contacts()) {
      const jid = bareBroadcastJid(contact.jid);
      if (!jid || jid === accountJid || contact.source === 'conversation') continue;
      const previous = contactsByJid.get(jid);
      if (!previous) {
        contactsByJid.set(jid, { ...contact, jid, groups: [...contact.groups] });
        continue;
      }
      contactsByJid.set(jid, {
        ...previous,
        name: previous.name || contact.name,
        groups: [...new Set([...previous.groups, ...contact.groups])],
        presence: previous.presence || contact.presence,
      });
    }
    return [...contactsByJid.values()].sort((left, right) =>
      (left.name || left.jid).localeCompare(right.name || right.jid),
    );
  });

  readonly groups = computed<ReadonlyArray<string>>(() =>
    [
      ...new Set(
        this.contacts().flatMap((contact) =>
          contact.groups.map((group) => group.trim()).filter(Boolean),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right)),
  );

  private attempt: BroadcastAttempt | null = null;
  private run = 0;
  private destroyed = false;

  constructor(private readonly dependencies: BroadcastCoordinatorDependencies) {}

  openDialog(): void {
    if (this.destroyed) return;
    this.body.set('');
    this.mode.set('normal');
    this.hideOffline.set(false);
    this.selectedJids.set(new Set<string>());
    this.busy.set(false);
    this.error.set(null);
    this.result.set(null);
    this.attempt = null;
    this.open.set(true);
  }

  closeDialog(): boolean {
    if (this.destroyed || this.busy()) return false;
    this.open.set(false);
    this.error.set(null);
    return true;
  }

  toggleContact(jid: string): void {
    const selected = new Set(this.selectedJids());
    if (selected.has(jid)) selected.delete(jid);
    else selected.add(jid);
    this.selectedJids.set(selected);
    this.error.set(null);
  }

  toggleGroup(group: string): void {
    const groupJids = this.contacts()
      .filter((contact) => contact.groups.includes(group))
      .map((contact) => bareBroadcastJid(contact.jid));
    const selected = new Set(this.selectedJids());
    const allSelected = groupJids.length > 0 && groupJids.every((jid) => selected.has(jid));
    groupJids.forEach((jid) => (allSelected ? selected.delete(jid) : selected.add(jid)));
    this.selectedJids.set(selected);
    this.error.set(null);
  }

  toggleAll(): void {
    const allJids = this.contacts().map((contact) => bareBroadcastJid(contact.jid));
    const selected = this.selectedJids();
    const allSelected = allJids.length > 0 && allJids.every((jid) => selected.has(jid));
    this.selectedJids.set(allSelected ? new Set<string>() : new Set(allJids));
    this.error.set(null);
  }

  async submit(retryAttempt?: BroadcastAttempt): Promise<boolean> {
    if (this.destroyed || this.busy()) return false;
    const mode = retryAttempt?.mode ?? this.mode();
    const body = (retryAttempt?.body ?? this.body()).trim();
    const currentJids = new Set(this.contacts().map((contact) => bareBroadcastJid(contact.jid)));
    const recipientJids = [...this.selectedJids()].filter((jid) => currentJids.has(jid));
    if (!body) {
      this.error.set('Escribe un mensaje antes de difundirlo.');
      return false;
    }
    if (!recipientJids.length) {
      this.error.set('Selecciona al menos un destinatario válido.');
      return false;
    }
    const accountId = this.dependencies.accountId();
    if (!this.dependencies.isConnected() || !accountId) {
      this.error.set('La cuenta no está conectada.');
      return false;
    }
    const run = ++this.run;
    this.attempt = { mode, body };
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      const result = await this.dependencies.sender.send({
        broadcastId: createOpaqueId('broadcast'),
        accountId,
        mode,
        body,
        recipientJids,
      });
      if (this.destroyed || run !== this.run) return false;
      this.result.set(result.recipients);
      if (result.recipients.every((item) => item.status === 'submitted')) {
        this.busy.set(false);
        this.open.set(false);
        return true;
      }
    } catch {
      if (!this.destroyed && run === this.run)
        this.error.set('No fue posible completar la difusión.');
    } finally {
      if (!this.destroyed && run === this.run) this.busy.set(false);
    }
    return false;
  }

  async retryFailed(): Promise<boolean> {
    const failed = this.result()
      ?.filter((item) => item.status === 'failed')
      .map((item) => item.recipientJid);
    if (!failed?.length || !this.attempt) return false;
    const attempt = this.attempt;
    this.mode.set(attempt.mode);
    this.body.set(attempt.body);
    this.selectedJids.set(new Set(failed));
    this.result.set(null);
    this.error.set(null);
    return this.submit(attempt);
  }

  cancelForAccount(): void {
    if (this.destroyed) return;
    this.run += 1;
    this.busy.set(false);
    this.open.set(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.run += 1;
    this.busy.set(false);
    this.open.set(false);
  }
}
