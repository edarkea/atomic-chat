import { signal, type WritableSignal } from '@angular/core';
import { createOpaqueId } from '../ids';
import type { Result, UserProfile } from '../domain';
import type { UserProfilePort } from '../ports';

export interface UserProfileCoordinatorDependencies {
  readonly port: UserProfilePort;
  readonly accountId: () => string;
  readonly identityGeneration: () => number;
  readonly isCurrent: (generation: number, accountId: string) => boolean;
  readonly isConnected: () => boolean;
  readonly reportError: (message: string) => void;
}

/** Loads one XEP-0054 profile for the active direct conversation at a time. */
export class UserProfileCoordinator {
  readonly profile: WritableSignal<UserProfile | null> = signal<UserProfile | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  private requestGeneration = 0;
  private requestedJid: string | null = null;
  private pendingJid: string | undefined;
  private activeLoad: Promise<void> | null = null;

  constructor(private readonly dependencies: UserProfileCoordinatorDependencies) {}

  async load(jid: string): Promise<void> {
    if (this.requestedJid === jid && this.activeLoad) return this.activeLoad;
    if (this.requestedJid === jid && this.profile()?.jid === jid) return;
    this.requestedJid = jid;
    this.requestGeneration += 1;
    this.pendingJid = jid;
    if (!this.activeLoad) this.activeLoad = this.drain();
    return this.activeLoad;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pendingJid !== undefined) {
        const jid = this.pendingJid;
        this.pendingJid = undefined;
        await this.loadLatest(jid);
      }
    } finally {
      this.activeLoad = null;
    }
  }

  private async loadLatest(jid: string): Promise<void> {
    const accountId = this.dependencies.accountId();
    const generation = this.dependencies.identityGeneration();
    const requestGeneration = this.requestGeneration;
    if (!accountId || !jid || !this.dependencies.isConnected()) {
      this.profile.set(null);
      this.loading.set(false);
      this.error.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    let result: Result<UserProfile>;
    try {
      result = await this.dependencies.port.get({
        version: 1,
        requestId: createOpaqueId('profile'),
        accountId,
        jid,
      });
    } catch {
      if (
        requestGeneration !== this.requestGeneration ||
        !this.dependencies.isCurrent(generation, accountId)
      )
        return;
      this.loading.set(false);
      this.profile.set(null);
      this.error.set('No fue posible cargar el perfil.');
      this.dependencies.reportError('No fue posible cargar el perfil.');
      return;
    }
    if (
      requestGeneration !== this.requestGeneration ||
      !this.dependencies.isCurrent(generation, accountId)
    )
      return;
    this.loading.set(false);
    if (result.ok) this.profile.set(result.value);
    else {
      this.profile.set(null);
      this.error.set(result.error.message);
      if (
        ![
          'UNSUPPORTED',
          'PROFILE_UNAVAILABLE',
          'NOT_CONNECTED',
          'TIMEOUT',
          'STALE_RESPONSE',
        ].includes(result.error.code)
      )
        this.dependencies.reportError(result.error.message);
    }
  }

  useCached(profile: UserProfile): void {
    this.requestGeneration += 1;
    this.requestedJid = profile.jid;
    this.pendingJid = undefined;
    this.profile.set(profile);
    this.loading.set(false);
    this.error.set(null);
  }

  clear(): void {
    this.requestGeneration += 1;
    this.requestedJid = null;
    this.pendingJid = undefined;
    this.profile.set(null);
    this.loading.set(false);
    this.error.set(null);
  }
}
