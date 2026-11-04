import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import { UpdateRequest, UpdateState, UpdateStatus } from './domain';
import { UPDATE_PORT, UpdatePort } from './ports';

@Injectable({ providedIn: 'root' })
export class UpdateFacade {
  private readonly port = inject<UpdatePort>(UPDATE_PORT);
  private readonly destroyRef = inject(DestroyRef);
  readonly status = signal<UpdateStatus>({
    version: 1,
    state: 'idle',
    currentVersion: '0.0.0',
  });
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    const unsubscribe = this.port.subscribe((status) => this.status.set(status));
    this.destroyRef.onDestroy(unsubscribe);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const result = await this.port.getStatus(this.request());
    if (result.ok) this.status.set(result.value);
  }

  async check(): Promise<void> {
    await this.run('check');
  }

  async download(): Promise<void> {
    await this.run('download');
  }

  async install(): Promise<void> {
    await this.run('install');
  }

  is(state: UpdateState): boolean {
    return this.status().state === state;
  }

  private async run(operation: 'check' | 'download' | 'install'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.port[operation](this.request());
      if (result.ok) this.status.set(result.value);
      else this.error.set(result.error.message);
    } finally {
      this.busy.set(false);
    }
  }

  private request(): UpdateRequest {
    return { version: 1, requestId: createOpaqueId(`update-${Date.now()}`) };
  }
}
