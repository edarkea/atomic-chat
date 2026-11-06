import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { VersionUpdateComponent } from './version-update.component';
import { LoginPanelComponent } from './login-panel.component';
import { OperatorPresenceComponent } from './operator-presence.component';
import { PreferencesDialogComponent, PreferencesDialogModel } from './preferences-dialog.component';
import { UpdateStatus } from './core/domain';

const status: UpdateStatus = { version: 1, state: 'up-to-date', currentVersion: '0.0.2' };

describe('desktop identity, background preference and version controls', () => {
  it('shows no update action without a release and emits download/install with progress', () => {
    const fixture = TestBed.createComponent(VersionUpdateComponent);
    fixture.componentRef.setInput('status', status);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('v0.0.2');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    const download = vi.fn();
    const install = vi.fn();
    fixture.componentInstance.download.subscribe(download);
    fixture.componentInstance.install.subscribe(install);
    fixture.componentRef.setInput('status', {
      ...status,
      state: 'available',
      availableVersion: '0.0.3',
    });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(download).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('status', {
      ...status,
      state: 'downloading',
      progressPercent: 42,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="status"]').textContent).toContain('42%');
    fixture.componentRef.setInput('status', { ...status, state: 'downloaded' });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(install).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(true);
  });

  it('exposes the same update action in login before a session exists', () => {
    const fixture = TestBed.createComponent(LoginPanelComponent);
    fixture.componentRef.setInput('accountId', '');
    fixture.componentRef.setInput('password', '');
    fixture.componentRef.setInput('updateStatus', {
      ...status,
      state: 'available',
      availableVersion: '0.0.3',
    });
    const download = vi.fn();
    fixture.componentInstance.downloadUpdate.subscribe(download);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('app-version-update button') as HTMLButtonElement).click();
    expect(download).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('app-version-update').textContent).toContain(
      'v0.0.2',
    );
    expect(fixture.nativeElement.querySelector('.login-logo')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('P0');
  });

  it('renders the full name safely and falls back to the local username', () => {
    const fixture = TestBed.createComponent(OperatorPresenceComponent);
    const model = {
      accountId: 'juan@example.invalid',
      displayName: 'Juan Munoz',
      connectionLabel: 'Conectado',
      presenceLabel: 'En línea',
      presenceDot: 'online',
      presenceOpen: false,
      presenceOptions: [],
      presenceOptionId: 'online',
      presenceStatus: '',
    };
    fixture.componentRef.setInput('model', model);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('strong').textContent).toBe('Juan Munoz');
    fixture.componentRef.setInput('model', { ...model, displayName: undefined });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('strong').textContent).toBe('Juan');
    fixture.componentRef.setInput('model', {
      ...model, accountId: 'juan.munoz@localhost', displayName: undefined,
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('strong').textContent).toBe('Juan Munoz');
    fixture.componentRef.setInput('model', {
      ...model, accountId: 'juan.munoz@localhost', displayName: 'Juan Muñoz Pérez',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('strong').textContent).toBe('Juan Muñoz Pérez');
    fixture.componentRef.setInput('model', { ...model, displayName: '<img src=x>' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('strong img')).toBeNull();
  });

  it('emits the background preference without changing other settings', async () => {
    const fixture = TestBed.createComponent(PreferencesDialogComponent);
    const model: PreferencesDialogModel = {
      preferences: {
        theme: 'atomic',
        notifications: true,
        autoAcceptFileTransfers: false,
        autoLogin: false,
        hideClosedConversations: false,
        fileTransferTimeoutSeconds: 300,
        downloadDirectory: '',
      },
      downloadDirectorySelecting: false,
      saveState: 'idle',
      error: null,
      updateStatus: status,
      updateBusy: false,
      updateError: null,
    };
    const changed = vi.fn();
    fixture.componentInstance.preferenceChange.subscribe(changed);
    fixture.componentRef.setInput('model', model);
    fixture.detectChanges();
    await fixture.whenStable();
    const toggle = fixture.nativeElement.querySelector('.preference-row input') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    toggle.click();
    expect(changed).toHaveBeenCalledWith({ closeToTray: true });
  });
});
