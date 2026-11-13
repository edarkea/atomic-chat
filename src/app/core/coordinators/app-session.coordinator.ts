import { computed, inject, Injectable, signal } from '@angular/core';
import { ChatFacade } from '../facades/chat.facade';
import { CertificateTrustDecision, XmppTransport } from '../domain';
import { FileFacade } from '../facades/file.facade';
import { MucFacade } from '../facades/muc.facade';
import type { ConnectionSettingsDraft } from '../../features/settings/connection-settings-dialog.component';

export interface LoginDraft {
  accountId: string;
  domain: string;
  password: string;
  host: string;
  port: number;
  transport: XmppTransport;
  automatic: boolean;
  remember: boolean;
  autoLogin: boolean;
  autoLoginExplicit: boolean;
}

const emptyLoginDraft = (): LoginDraft => ({
  accountId: '',
  domain: '',
  password: '',
  host: '',
  port: 5222,
  transport: 'starttls',
  automatic: true,
  remember: false,
  autoLogin: false,
  autoLoginExplicit: false,
});

@Injectable({ providedIn: 'root' })
export class AppSessionCoordinator {
  private readonly chat = inject(ChatFacade);
  private readonly muc = inject(MucFacade);
  private readonly files = inject(FileFacade);

  readonly login = signal<LoginDraft>(emptyLoginDraft());
  readonly loginBusy = signal(false);
  readonly profileActionBusy = signal(false);
  readonly selectedProfileId = signal('');
  readonly loginProfiles = computed(() => this.chat.profiles?.() ?? []);
  readonly settingsOpen = signal(false);
  readonly settingsSaving = signal(false);
  readonly settingsError = signal<string | null>(null);
  readonly settingsDraft = computed<ConnectionSettingsDraft>(() => {
    const value = this.login();
    return {
      automatic: value.automatic,
      host: value.host,
      port: value.port,
      transport: value.transport,
    };
  });
  readonly certificateRequest = computed(() => this.chat.certificateRequest?.() ?? null);

  setLoginAccount(accountId: string): void {
    if (accountId !== this.login().accountId && this.selectedProfileId()) {
      this.selectedProfileId.set('');
      this.login.update((value) => ({
        ...value,
        accountId,
        password: '',
        remember: false,
        autoLogin: false,
        autoLoginExplicit: false,
      }));
      return;
    }
    this.login.update((value) => ({ ...value, accountId }));
  }

  setLoginDomain(domain: string): void {
    const selected = this.loginProfiles().find(
      (profile) => profile.accountId === this.selectedProfileId(),
    );
    if (selected?.accountId.includes('@') && domain !== this.login().domain) {
      this.selectedProfileId.set('');
      this.login.update((value) => ({
        ...value,
        password: '',
        remember: false,
        autoLogin: false,
        autoLoginExplicit: false,
      }));
    }
    this.login.update((value) => ({ ...value, domain }));
  }

  setLoginPassword(password: string): void {
    this.login.update((value) => ({ ...value, password }));
  }

  setLoginHost(host: string): void {
    this.login.update((value) => ({ ...value, host }));
  }

  setLoginPort(port: number): void {
    this.login.update((value) => ({ ...value, port }));
  }

  setLoginTransport(transport: XmppTransport): void {
    this.login.update((value) => ({
      ...value,
      transport,
      port:
        value.port === (transport === 'direct-tls' ? 5222 : 5223)
          ? transport === 'direct-tls'
            ? 5223
            : 5222
          : value.port,
    }));
  }

  setLoginAutomatic(automatic: boolean): void {
    this.login.update((value) => ({ ...value, automatic }));
  }

  setLoginRemember(remember: boolean): void {
    this.login.update((value) => ({
      ...value,
      remember,
      autoLogin: remember ? value.autoLogin : false,
      autoLoginExplicit: true,
    }));
  }

  setLoginAutoLogin(autoLogin: boolean): void {
    this.login.update((value) => ({ ...value, autoLogin, autoLoginExplicit: true }));
  }

  async selectLoginProfile(accountId: string): Promise<void> {
    this.selectedProfileId.set(accountId);
    const profile = this.loginProfiles().find((item) => item.accountId === accountId);
    if (!profile) {
      this.resetLoginForNewAccount();
      return;
    }
    const at = profile.accountId.lastIndexOf('@');
    this.login.update((value) => ({
      ...value,
      accountId: at > 0 ? profile.accountId.slice(0, at) : profile.accountId,
      domain: profile.domain,
      host: profile.manualEndpoint?.host || '',
      port: profile.manualEndpoint?.port || 5222,
      transport: profile.manualEndpoint?.transport || 'starttls',
      automatic: profile.mode === 'automatic',
      password: '',
      remember: profile.hasPersistentCredential === true,
      autoLogin: false,
      autoLoginExplicit: false,
    }));
    const preferences = await this.chat.getProfilePreferences(profile.accountId);
    if (this.selectedProfileId() !== profile.accountId) return;
    this.login.update((value) => ({
      ...value,
      autoLogin: profile.hasPersistentCredential === true && Boolean(preferences?.autoLogin),
    }));
  }

  async forgetLoginSecret(): Promise<void> {
    const accountId = this.selectedProfileId();
    if (!accountId || this.profileActionBusy()) return;
    this.profileActionBusy.set(true);
    try {
      if (await this.chat.forgetSecret(accountId))
        this.login.update((value) => ({ ...value, autoLogin: false, remember: false }));
    } finally {
      this.profileActionBusy.set(false);
    }
  }

  async recoverSecretStorage(accountId: string): Promise<void> {
    if (this.profileActionBusy()) return;
    this.profileActionBusy.set(true);
    try {
      if (await this.chat.recoverSecretStorage(accountId)) await this.selectLoginProfile(accountId);
    } finally {
      this.profileActionBusy.set(false);
    }
  }

  async resetSecretStorage(accountId: string): Promise<void> {
    if (this.profileActionBusy()) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'El almacenamiento seguro se reiniciará y tendrás que introducir nuevamente las contraseñas guardadas. ¿Continuar?',
      )
    )
      return;
    this.profileActionBusy.set(true);
    try {
      if (await this.chat.resetSecretStorage(accountId)) await this.selectLoginProfile(accountId);
    } finally {
      this.profileActionBusy.set(false);
    }
  }

  async deleteLoginProfile(): Promise<void> {
    const accountId = this.selectedProfileId();
    if (!accountId || this.profileActionBusy()) return;
    this.profileActionBusy.set(true);
    try {
      if (await this.chat.deleteProfile(accountId)) {
        this.selectedProfileId.set('');
        this.resetLoginForNewAccount();
      }
    } finally {
      this.profileActionBusy.set(false);
    }
  }

  openAdvancedSettings(): void {
    this.settingsError.set(null);
    this.settingsOpen.set(true);
  }

  cancelAdvancedSettings(): void {
    this.settingsError.set(null);
    this.settingsOpen.set(false);
  }

  async saveAdvancedSettings(settings: ConnectionSettingsDraft): Promise<void> {
    if (!settings.automatic && (!settings.host.trim() || !Number.isInteger(settings.port))) {
      this.settingsError.set('Indica un host y un puerto entero entre 1 y 65535.');
      return;
    }
    if (!settings.automatic && (settings.port < 1 || settings.port > 65535)) {
      this.settingsError.set('El puerto debe estar entre 1 y 65535.');
      return;
    }
    this.settingsSaving.set(true);
    this.settingsError.set(null);
    try {
      const selected = this.loginProfiles().find(
        (profile) => profile.accountId === this.selectedProfileId(),
      );
      if (selected) {
        const domain = selected.accountId.includes('@')
          ? selected.domain
          : this.login().domain.trim();
        if (!domain) {
          this.settingsError.set('Indica el dominio XMPP de la cuenta heredada antes de guardar.');
          return;
        }
        const saved = await this.chat.saveProfile({
          ...selected,
          domain,
          mode: settings.automatic ? 'automatic' : 'manual',
          ...(settings.automatic
            ? { manualEndpoint: undefined }
            : {
                manualEndpoint: {
                  host: settings.host.trim(),
                  port: settings.port,
                  transport: settings.transport,
                },
              }),
          updatedAt: new Date().toISOString(),
        });
        if (!saved?.ok) {
          this.settingsError.set(saved?.error.message || 'No fue posible guardar el perfil.');
          return;
        }
      }
      this.login.update((value) => ({
        ...value,
        automatic: settings.automatic,
        host: settings.host.trim(),
        port: settings.port,
        transport: settings.transport,
      }));
      this.cancelAdvancedSettings();
    } finally {
      this.settingsSaving.set(false);
    }
  }

  async connect(): Promise<void> {
    const login = this.login();
    const rawUser = login.accountId.trim();
    const suppliedDomain = (login.domain || '').trim().toLowerCase().replace(/\.$/, '');
    const at = rawUser.indexOf('@');
    if (
      at >= 0 &&
      (at !== rawUser.lastIndexOf('@') || !rawUser.slice(0, at) || !rawUser.slice(at + 1))
    ) {
      this.chat.error.set('Introduce un usuario XMPP o un JID completo válido.');
      return;
    }
    const localpart = at >= 0 ? rawUser.slice(0, at) : rawUser;
    const domain = at >= 0 ? rawUser.slice(at + 1).toLowerCase() : suppliedDomain;
    if (!localpart || /[\s/@]/.test(localpart) || !domain || /[\s/@]/.test(domain)) {
      this.chat.error.set('El usuario y el dominio XMPP son obligatorios.');
      return;
    }
    const selectedProfile = this.loginProfiles().find(
      (profile) => profile.accountId === this.selectedProfileId(),
    );
    const legacyProfile =
      selectedProfile && !selectedProfile.accountId.includes('@') ? selectedProfile : undefined;
    const accountId = legacyProfile ? legacyProfile.accountId : `${localpart}@${domain}`;
    this.muc.setAccount(accountId);
    this.loginBusy.set(true);
    try {
      const connected = await this.chat.connect(accountId, login.password, {
        ...(legacyProfile ? { profile: legacyProfile } : {}),
        domain,
        mode: login.automatic !== false ? 'automatic' : 'manual',
        manualEndpoint: {
          host: (login.host || '').trim(),
          port: login.port || 5222,
          transport: login.transport || 'starttls',
        },
        remember: login.remember === true,
        autoLogin: login.autoLogin === true,
        autoLoginExplicit: login.autoLoginExplicit === true,
      });
      if (connected) {
        this.login.update((value) => ({ ...value, password: '' }));
        await this.files.setAccount(this.chat.accountId());
      }
    } finally {
      this.loginBusy.set(false);
    }
  }

  async disconnect(): Promise<void> {
    await this.chat.disconnect();
    await this.files.setAccount('');
  }

  decideCertificate(decision: CertificateTrustDecision): Promise<void> {
    return this.chat.decideCertificate(decision);
  }

  tryAutoLogin(): Promise<void> {
    return this.chat.tryAutoLogin();
  }

  private resetLoginForNewAccount(): void {
    this.login.set(emptyLoginDraft());
  }
}
