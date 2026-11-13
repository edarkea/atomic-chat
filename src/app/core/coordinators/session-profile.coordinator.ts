import { signal, type WritableSignal } from '@angular/core';
import { createOpaqueId } from '../ids';
import type {
  CertificateTrustDecision,
  CertificateTrustRequest,
  ConnectionState,
  Contact,
  Preferences,
  Result,
  XmppConnectionProfile,
} from '../domain';
import type { AccountPort, CertificatePort, PreferencesPort, XmppPort } from '../ports';

export interface SessionProfileDependencies {
  readonly account: AccountPort;
  readonly certificate: CertificatePort;
  readonly preferences: PreferencesPort;
  readonly xmpp: XmppPort;
  readonly isAvailable: () => boolean;
  readonly reportError: (message: string) => void;
  readonly clearError: () => void;
  readonly beforeAccountSwitch: (previousAccount: string, nextAccount: string) => void;
  readonly afterAccountSwitch: (accountId: string) => void;
  readonly applyPreferences: (changes: Partial<Preferences>) => void;
  readonly setPreferences: (preferences: Preferences) => void;
  readonly mergeRoster: (roster: Contact[]) => void;
  readonly loadStoredConversations: (accountId: string, generation: number) => Promise<void>;
  readonly loadPreferences: (generation: number, accountId: string) => Promise<void>;
  readonly onSessionAuthenticated: () => void;
  readonly clearChatStates: () => void;
  readonly resetRemotePresence: (accountId: string) => void;
}

function loginErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : error instanceof Error
        ? error.message
        : '';
  const messages: Record<string, string> = {
    AUTH_FAILED: 'El servidor rechazó la autenticación.',
    SERVER_UNREACHABLE: 'No fue posible alcanzar el servidor XMPP.',
    STORAGE_FAILED: 'No fue posible acceder al almacenamiento seguro.',
    INVALID_INPUT: 'La configuración o las credenciales no son válidas.',
    TRANSPORT_FAILED: 'El transporte XMPP no pudo completar la conexión.',
    INTERNAL: 'No fue posible completar el inicio de sesión por un error interno controlado.',
    secret_unavailable: 'No fue posible acceder al almacenamiento seguro.',
    'XMPP endpoint is not configured': 'La configuración del endpoint XMPP no es válida.',
  };
  return messages[code] || messages['INTERNAL'];
}

/** Owns account identity, connection lifecycle, certificates, profiles and credentials. */
export class SessionProfileCoordinator {
  readonly accountId: WritableSignal<string>;
  readonly connection: WritableSignal<ConnectionState>;
  readonly certificateRequest: WritableSignal<CertificateTrustRequest | null>;
  readonly profiles: WritableSignal<ReadonlyArray<XmppConnectionProfile>>;

  private sessionGeneration = 0;
  private acceptingConnectionEvents = true;

  constructor(private readonly dependencies: SessionProfileDependencies) {
    this.accountId = signal(this.dependencies.account.getConfig()?.accountId || '');
    this.connection = signal<ConnectionState>({
      accountId: this.accountId(),
      status: 'idle',
      retryable: false,
      since: new Date().toISOString(),
    });
    this.certificateRequest = signal<CertificateTrustRequest | null>(null);
    this.profiles = signal<ReadonlyArray<XmppConnectionProfile>>([]);
  }

  identityGeneration(): number {
    return this.sessionGeneration;
  }

  isCurrent(generation: number, accountId: string): boolean {
    return generation === this.sessionGeneration && accountId === this.accountId();
  }

  handleCertificateTrustRequired(request: CertificateTrustRequest): void {
    if (request.accountId === this.accountId()) this.certificateRequest.set(request);
  }

  handleConnectionStateChanged(state: ConnectionState): boolean {
    if (state.accountId !== this.accountId() || !this.acceptingConnectionEvents) return false;
    if (state.status === 'idle' || state.status === 'failed') this.sessionGeneration += 1;
    this.connection.set(state);
    if (state.status === 'idle' || state.status === 'failed') {
      this.dependencies.clearChatStates();
      this.dependencies.resetRemotePresence(state.accountId);
    }
    return true;
  }

  async decideCertificate(decision: CertificateTrustDecision): Promise<void> {
    const request = this.certificateRequest();
    if (!request || !this.dependencies.isAvailable()) return;
    try {
      const result = await this.dependencies.certificate.decide({
        version: 1,
        requestId: request.requestId,
        accountId: request.accountId,
        fingerprintSha256: request.certificate.fingerprintSha256,
        decision,
      });
      if (!result.ok) this.dependencies.reportError(result.error.message);
      else this.certificateRequest.set(null);
    } catch {
      this.dependencies.reportError('No fue posible aplicar la decisión del certificado.');
    }
  }

  async tryAutoLogin(): Promise<void> {
    if (!this.dependencies.isAvailable()) return;
    const listed = await this.loadProfiles();
    if (listed.length) {
      for (const profile of [...listed].sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.accountId.localeCompare(right.accountId),
      )) {
        if (!profile.domain.trim() || profile.hasPersistentCredential !== true) continue;
        const result = await this.dependencies.preferences.get({ accountId: profile.accountId });
        if (result.ok && result.value.autoLogin) {
          this.dependencies.setPreferences(result.value);
          await this.connect(profile.accountId, '', {
            profile,
            remember: true,
            autoLogin: true,
            autoLoginExplicit: true,
          });
          return;
        }
      }
      return;
    }
    const accountId = this.accountId();
    if (!accountId) return;
    const result = await this.dependencies.preferences.get({ accountId });
    if (result.ok && result.value.autoLogin) await this.connect(accountId);
  }

  async loadProfiles(): Promise<ReadonlyArray<XmppConnectionProfile>> {
    const listProfiles = this.dependencies.account.listProfiles;
    if (!listProfiles) return this.profiles();
    const result = await listProfiles.call(
      this.dependencies.account,
      createOpaqueId('profiles-list'),
    );
    if (result.ok) this.profiles.set(result.value);
    return result.ok ? result.value : [];
  }

  async getProfilePreferences(accountId: string): Promise<Preferences | undefined> {
    if (!this.dependencies.isAvailable()) return undefined;
    const result = await this.dependencies.preferences.get({ accountId });
    return result.ok ? result.value : undefined;
  }

  async saveProfile(
    profile: XmppConnectionProfile,
  ): Promise<Result<XmppConnectionProfile> | undefined> {
    const saveProfile = this.dependencies.account.saveProfile;
    if (!saveProfile) return undefined;
    const result = await saveProfile.call(
      this.dependencies.account,
      profile,
      createOpaqueId('profiles-save'),
    );
    if (result.ok) {
      const saved = this.withCredentialStatus(result.value);
      this.upsertProfile(saved);
      return { ...result, value: saved };
    }
    this.dependencies.reportError(result.error.message);
    return result;
  }

  async forgetSecret(accountId: string): Promise<boolean> {
    const forgetSecret = this.dependencies.account.forgetSecret;
    const result = await forgetSecret?.({
      version: 1,
      requestId: createOpaqueId('forget-secret'),
      accountId,
    });
    if (!result) return false;
    if (!result.ok) {
      this.dependencies.reportError(result.error.message);
      return false;
    }
    this.profiles.update((items) =>
      items.map((item) =>
        item.accountId === accountId ? { ...item, hasPersistentCredential: false } : item,
      ),
    );
    return true;
  }

  async recoverSecretStorage(accountId: string): Promise<boolean> {
    const recover = this.dependencies.account.recoverSecretStorage;
    const result = await recover?.({
      version: 1,
      requestId: createOpaqueId('recover-secret-storage'),
      accountId,
    });
    if (!result) return false;
    if (!result.ok) {
      this.dependencies.reportError(result.error.message);
      return false;
    }
    await this.loadProfiles();
    return true;
  }

  async resetSecretStorage(accountId: string): Promise<boolean> {
    const reset = this.dependencies.account.resetSecretStorage;
    const result = await reset?.({
      version: 1,
      requestId: createOpaqueId('reset-secret-storage'),
      accountId,
    });
    if (!result) return false;
    if (!result.ok) {
      this.dependencies.reportError(result.error.message);
      return false;
    }
    await this.loadProfiles();
    return true;
  }

  async deleteProfile(accountId: string): Promise<boolean> {
    const deleteProfile = this.dependencies.account.deleteProfile;
    const result = await deleteProfile?.(accountId, createOpaqueId('profiles-delete'));
    if (!result) return false;
    if (!result.ok) {
      this.dependencies.reportError(result.error.message);
      return false;
    }
    this.profiles.update((items) => items.filter((profile) => profile.accountId !== accountId));
    return true;
  }

  async connect(
    accountId = this.accountId(),
    secret = '',
    options?: {
      profile?: XmppConnectionProfile;
      domain?: string;
      mode?: 'automatic' | 'manual';
      manualEndpoint?: XmppConnectionProfile['manualEndpoint'];
      remember?: boolean;
      autoLogin?: boolean;
      autoLoginExplicit?: boolean;
    },
  ): Promise<boolean> {
    const generation = ++this.sessionGeneration;
    this.acceptingConnectionEvents = false;
    const requestedAccount = accountId.trim();
    const previousAccount = this.accountId();
    if (previousAccount && previousAccount !== requestedAccount)
      this.dependencies.beforeAccountSwitch(previousAccount, requestedAccount);
    this.dependencies.clearError();
    this.certificateRequest.set(null);
    this.accountId.set(requestedAccount);
    this.dependencies.afterAccountSwitch(requestedAccount);

    try {
      const requestId = createOpaqueId('req');
      const credentialRef = `account:${requestedAccount}`;
      const remember = options?.remember ?? true;
      if (!secret.trim() && !remember) {
        this.dependencies.reportError('Introduce la contraseña para una sesión sin recordar.');
        return false;
      }
      const legacyProfile =
        options?.profile && !options.profile.accountId.includes('@') ? options.profile : undefined;
      const profile =
        legacyProfile ||
        (options?.domain
          ? {
              accountId: requestedAccount,
              domain: options.domain,
              mode: options.mode || 'automatic',
              ...(options.mode === 'manual' && options.manualEndpoint
                ? { manualEndpoint: options.manualEndpoint }
                : {}),
              updatedAt: new Date().toISOString(),
            }
          : undefined);
      if (profile && !legacyProfile && this.dependencies.account.saveProfile) {
        const saved = await this.dependencies.account.saveProfile(
          profile,
          createOpaqueId('profiles-save'),
        );
        if (!saved.ok) throw new Error(saved.error.message);
        this.upsertProfile(this.withCredentialStatus(saved.value));
      }
      if (secret) {
        const stored = await this.dependencies.account.setSecret({
          version: 1,
          requestId,
          credentialRef,
          secret,
          accountId: requestedAccount,
          remember,
        });
        if (!stored.ok) {
          if (this.isCurrent(generation, requestedAccount))
            this.dependencies.reportError(stored.error.message);
          return false;
        }
        this.profiles.update((items) =>
          items.map((item) =>
            item.accountId === requestedAccount
              ? { ...item, hasPersistentCredential: remember }
              : item,
          ),
        );
      }
      const endpoint = this.dependencies.account.getConfig()?.endpoint;
      if (!profile && (!endpoint?.host || !endpoint.port))
        throw new Error('XMPP endpoint is not configured');
      if (profile && options?.autoLoginExplicit) {
        const preference = await this.dependencies.preferences.update({
          accountId: requestedAccount,
          changes: { autoLogin: Boolean(options.autoLogin && remember) },
        });
        if (preference.ok) this.dependencies.applyPreferences(preference.value);
      }
      const result = await this.dependencies.xmpp.connect({
        version: 1,
        requestId,
        accountId: requestedAccount,
        ...(endpoint ? { endpoint } : {}),
        ...(options?.profile || profile
          ? { profileId: (options?.profile || profile)?.accountId }
          : {}),
        ...(options?.domain ? { profileDomain: options.domain } : {}),
        credentialRef,
      });
      if (!result.ok) {
        if (this.isCurrent(generation, requestedAccount))
          this.dependencies.reportError(result.error.message);
        return false;
      }
      if (!this.isCurrent(generation, requestedAccount)) return false;
      this.acceptingConnectionEvents = true;
      const current = this.connection();
      this.connection.set({
        ...result.value,
        displayName:
          result.value.displayName ??
          (current.accountId === requestedAccount && current.since === result.value.since
            ? current.displayName
            : undefined),
      });
      this.dependencies.onSessionAuthenticated();
      const roster = await this.dependencies.xmpp.listRoster(requestedAccount);
      if (!this.isCurrent(generation, requestedAccount)) return false;
      if (roster.ok) this.dependencies.mergeRoster(roster.value);
      await this.dependencies.loadStoredConversations(requestedAccount, generation);
      if (!this.isCurrent(generation, requestedAccount)) return false;
      await this.dependencies.loadPreferences(generation, requestedAccount);
      if (!this.isCurrent(generation, requestedAccount)) return false;
      return true;
    } catch (error: unknown) {
      if (this.isCurrent(generation, requestedAccount))
        this.dependencies.reportError(loginErrorMessage(error));
      return false;
    }
  }

  async disconnect(): Promise<void> {
    const generation = ++this.sessionGeneration;
    this.acceptingConnectionEvents = false;
    const accountId = this.accountId();
    const previousConnection = this.connection();
    this.certificateRequest.set(null);
    this.connection.set({
      ...previousConnection,
      status: 'disconnecting',
      since: new Date().toISOString(),
    });
    const result = await this.dependencies.xmpp.disconnect(accountId);
    if (!this.isCurrent(generation, accountId)) return;
    if (result.ok) {
      this.connection.set({
        ...this.connection(),
        status: 'idle',
        since: new Date().toISOString(),
      });
      this.dependencies.clearChatStates();
    } else {
      this.connection.set(previousConnection);
    }
  }

  async refreshState(): Promise<void> {
    const result = await this.dependencies.xmpp.getState(this.accountId());
    if (result.ok) this.connection.set(result.value);
    else this.dependencies.reportError(result.error.message);
  }

  private withCredentialStatus(profile: XmppConnectionProfile): XmppConnectionProfile {
    const previous = this.profiles().find((item) => item.accountId === profile.accountId);
    return {
      ...profile,
      hasPersistentCredential:
        profile.hasPersistentCredential ?? previous?.hasPersistentCredential ?? false,
    };
  }

  private upsertProfile(profile: XmppConnectionProfile): void {
    this.profiles.update((items) => [
      profile,
      ...items.filter((item) => item.accountId !== profile.accountId),
    ]);
  }
}
