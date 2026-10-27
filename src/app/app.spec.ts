import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { App } from './app';
import { P0Facade } from './core/p0.facade';

function fakeFacade() {
  return {
    accountId: signal('a@example.invalid'), connection: signal({ accountId: 'a@example.invalid', status: 'connected', retryable: false, since: new Date().toISOString() }),
    contacts: signal([]), messages: signal([]), presence: signal({ jid: 'a@example.invalid', availability: 'available' }),
    preferences: signal({ theme: 'atomic', notifications: true, autoLogin: false }), error: signal<string | null>(null), tryAutoLogin: vi.fn(),
    isConnected: signal(true), send: vi.fn(async () => true), setAvailability: vi.fn(), updatePreferences: vi.fn(), resetPreferences: vi.fn(), disconnect: vi.fn(), refreshRoster: vi.fn(),
  } as unknown as P0Facade;
}

describe('App composer integration', () => {
  let fixture: ComponentFixture<App>; let facade: ReturnType<typeof fakeFacade>;
  beforeEach(async () => { facade = fakeFacade(); await TestBed.configureTestingModule({ imports: [App], providers: [{ provide: P0Facade, useValue: facade }] }).compileComponents(); fixture = TestBed.createComponent(App); fixture.detectChanges(); (fixture.componentInstance as any).selectedJid.set('contact@example.invalid'); fixture.detectChanges(); });

  it('clears only after local acceptance', async () => { const input = fixture.nativeElement.querySelector('input[name="message"]'); input.value = 'hola'; input.dispatchEvent(new Event('input')); fixture.detectChanges(); await fixture.nativeElement.querySelector('form.composer').requestSubmit(); fixture.detectChanges(); expect((fixture.componentInstance as any).draft()).toBe(''); });
  it('preserves the draft after a failed result or exception', async () => { const send = facade.send as any; send.mockResolvedValueOnce(false); const input = fixture.nativeElement.querySelector('input[name="message"]'); input.value = 'reintentar'; input.dispatchEvent(new Event('input')); await fixture.nativeElement.querySelector('form.composer').requestSubmit(); expect((fixture.componentInstance as any).draft()).toBe('reintentar'); send.mockRejectedValueOnce(new Error('ipc')); await fixture.nativeElement.querySelector('form.composer').requestSubmit(); expect((fixture.componentInstance as any).draft()).toBe('reintentar'); });
  it('preserves newer content while an earlier send is pending', async () => { let resolve!: (value: boolean) => void; const send = facade.send as any; send.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; })); const input = fixture.nativeElement.querySelector('input[name="message"]'); input.value = 'viejo'; input.dispatchEvent(new Event('input')); const pending = fixture.nativeElement.querySelector('form.composer').requestSubmit(); input.value = 'nuevo'; input.dispatchEvent(new Event('input')); resolve(true); await pending; expect((fixture.componentInstance as any).draft()).toBe('nuevo'); });
  it('preserves text when the account is disconnected', async () => { const send = facade.send as any; send.mockResolvedValueOnce(false); const input = fixture.nativeElement.querySelector('input[name="message"]'); input.value = 'sin conexión'; input.dispatchEvent(new Event('input')); await fixture.nativeElement.querySelector('form.composer').requestSubmit(); expect((fixture.componentInstance as any).draft()).toBe('sin conexión'); });
  it('shows an accessible error after an IPC exception', async () => { const send = facade.send as any; send.mockRejectedValueOnce(new Error('ipc')); const input = fixture.nativeElement.querySelector('input[name="message"]'); input.value = 'error'; input.dispatchEvent(new Event('input')); await fixture.nativeElement.querySelector('form.composer').requestSubmit(); fixture.detectChanges(); expect((fixture.componentInstance as any).draft()).toBe('error'); expect(fixture.nativeElement.textContent).toContain('No fue posible enviar el mensaje.'); });
  it('does not clear a draft after the conversation context changes', async () => { let resolve!: (value: boolean) => void; const send = facade.send as any; send.mockImplementationOnce(() => new Promise<boolean>((done) => { resolve = done; })); const input = fixture.nativeElement.querySelector('input[name="message"]'); input.value = 'cuenta A'; input.dispatchEvent(new Event('input')); const pending = fixture.nativeElement.querySelector('form.composer').requestSubmit(); (fixture.componentInstance as any).selectedJid.set('other@example.invalid'); input.value = 'cuenta B'; input.dispatchEvent(new Event('input')); resolve(true); await pending; expect((fixture.componentInstance as any).draft()).toBe('cuenta B'); });
});
