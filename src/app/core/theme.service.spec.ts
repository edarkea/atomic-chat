import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Preferences, Result, ThemePalette } from './domain';
import { PREFERENCES_PORT, PreferencesPort } from './ports';
import {
  ATOMIC_THEME_PALETTE,
  DARK_THEME_PALETTE,
  LIGHT_THEME_PALETTE,
  ThemeService,
  validateThemePalette,
} from './theme.service';

const validCustomPalette: ThemePalette = {
  ...ATOMIC_THEME_PALETTE,
  background: '#101410',
  surface: '#182019',
  surfaceRaised: '#263328',
  accent: '#72ff8b',
  text: '#f1fff3',
  textSecondary: '#c9ffd0',
  border: '#74d487',
  incomingBubble: '#28422d',
  outgoingBubble: '#365f3f',
  focus: '#baffc2',
};

function ok<T>(value: T): Result<T> {
  return { ok: true, value, version: 1, requestId: 'theme-test' };
}

describe('ThemeService', () => {
  let preferences: PreferencesPort;
  let stored: Preferences;

  beforeEach(() => {
    stored = { theme: 'atomic', notifications: true, autoLogin: false };
    preferences = {
      get: vi.fn(async () => ok(stored)),
      update: vi.fn(async ({ changes }) => {
        stored = { ...stored, ...changes };
        return ok(changes);
      }),
      reset: vi.fn(async () => ok(stored)),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: PREFERENCES_PORT, useValue: preferences }],
    });
  });

  it('loads and applies a persisted custom theme before the UI is used', async () => {
    stored = {
      theme: 'custom',
      customTheme: validCustomPalette,
      notifications: false,
      autoLogin: true,
    };
    const service = TestBed.inject(ThemeService);

    await service.initialize();

    expect(service.themeId()).toBe('custom');
    expect(service.activePalette()).toEqual(validCustomPalette);
    expect(document.documentElement.style.getPropertyValue('--atomic-bg')).toBe('#101410');
    expect(preferences.get).toHaveBeenCalledWith({ accountId: '' });
  });

  it('previews changes and cancels without persisting them', async () => {
    const service = TestBed.inject(ThemeService);
    await service.initialize();
    service.openStudio();
    service.setDraftColor('accent', '#ffffff');

    service.cancelStudio();

    expect(service.editorOpen()).toBe(false);
    expect(service.activePalette()).toEqual(ATOMIC_THEME_PALETTE);
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it('applies a valid custom palette immediately and persists it', async () => {
    const service = TestBed.inject(ThemeService);
    await service.initialize();
    service.openStudio();
    for (const [key, value] of Object.entries(validCustomPalette))
      service.setDraftColor(key as keyof ThemePalette, value);

    expect(await service.applyDraft()).toBe(true);
    expect(service.themeId()).toBe('custom');
    expect(service.activePalette()).toEqual(validCustomPalette);
    expect(document.documentElement.style.getPropertyValue('--atomic-bubble-outgoing')).toBe(
      validCustomPalette.outgoingBubble,
    );
    expect(preferences.update).toHaveBeenCalledWith({
      accountId: '',
      changes: { theme: 'custom', customTheme: validCustomPalette },
    });
  });

  it('rejects invalid contrast and keeps the previous active theme after save errors', async () => {
    const service = TestBed.inject(ThemeService);
    await service.initialize();
    service.openStudio();
    service.setDraftColor('text', '#111111');
    expect(await service.applyDraft()).toBe(false);
    expect(service.validationError()).toContain('contraste');

    service.setDraftColor('text', validCustomPalette.text);
    const failure: Result<Partial<Preferences>> = {
      ok: false,
      version: 1,
      error: { code: 'STORAGE_FAILED', retryable: false, requestId: 'save', message: 'falló' },
    };
    preferences.update = vi.fn(async () => failure);
    expect(await service.applyDraft()).toBe(false);
    expect(service.themeId()).toBe('atomic');
    expect(service.editorOpen()).toBe(true);
    expect(service.persistenceError()).toBe('falló');
  });

  it('restores the original theme without changing unrelated preferences', async () => {
    stored = {
      theme: 'custom',
      customTheme: validCustomPalette,
      notifications: false,
      autoLogin: true,
    };
    const service = TestBed.inject(ThemeService);
    await service.initialize();

    expect(await service.restoreOriginal()).toBe(true);

    expect(service.themeId()).toBe('atomic');
    expect(service.activePalette()).toEqual(ATOMIC_THEME_PALETTE);
    expect(stored.notifications).toBe(false);
    expect(stored.autoLogin).toBe(true);
  });

  it('switches presets immediately without overwriting the saved custom palette', async () => {
    stored = {
      theme: 'dark',
      customTheme: validCustomPalette,
      notifications: true,
      autoLogin: false,
    };
    const service = TestBed.inject(ThemeService);
    await service.initialize();

    expect(service.themeId()).toBe('dark');
    expect(service.activePalette()).toEqual(DARK_THEME_PALETTE);
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');

    expect(await service.selectTheme('light')).toBe(true);
    expect(service.activePalette()).toEqual(LIGHT_THEME_PALETTE);
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
    expect(preferences.update).toHaveBeenLastCalledWith({
      accountId: '',
      changes: { theme: 'light' },
    });
    expect(stored.customTheme).toEqual(validCustomPalette);

    expect(await service.selectTheme('custom')).toBe(true);
    expect(service.themeId()).toBe('custom');
    expect(service.activePalette()).toEqual(validCustomPalette);
    expect(stored.customTheme).toEqual(validCustomPalette);
    expect(preferences.update).toHaveBeenLastCalledWith({
      accountId: '',
      changes: { theme: 'custom' },
    });
  });

  it('uses the active preset as the studio draft and keeps it on cancel', async () => {
    const service = TestBed.inject(ThemeService);
    await service.initialize();
    await service.selectTheme('dark');
    service.openStudio();

    expect(service.draftPalette()).toEqual(DARK_THEME_PALETTE);
    service.setDraftColor('accent', '#ffffff');
    service.cancelStudio();

    expect(service.themeId()).toBe('dark');
    expect(service.activePalette()).toEqual(DARK_THEME_PALETTE);
    expect(preferences.update).toHaveBeenCalledWith({
      accountId: '',
      changes: { theme: 'dark' },
    });
  });

  it('opens the studio instead of inventing a custom theme', async () => {
    const service = TestBed.inject(ThemeService);
    await service.initialize();

    expect(await service.selectTheme('custom')).toBe(false);
    expect(service.editorOpen()).toBe(true);
    expect(service.themeId()).toBe('atomic');
    expect(preferences.update).not.toHaveBeenCalled();
  });

  it('rolls a preset change back when persistence fails', async () => {
    const service = TestBed.inject(ThemeService);
    await service.initialize();
    const failure: Result<Partial<Preferences>> = {
      ok: false,
      version: 1,
      error: { code: 'STORAGE_FAILED', retryable: false, requestId: 'save', message: 'falló' },
    };
    preferences.update = vi.fn(async () => failure);

    expect(await service.selectTheme('light')).toBe(false);
    expect(service.themeId()).toBe('atomic');
    expect(service.activePalette()).toEqual(ATOMIC_THEME_PALETTE);
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(service.persistenceError()).toBe('falló');
  });
});

describe('validateThemePalette', () => {
  it('accepts both official presets', () => {
    expect(validateThemePalette(DARK_THEME_PALETTE)).toEqual({ valid: true });
    expect(validateThemePalette(LIGHT_THEME_PALETTE)).toEqual({ valid: true });
  });

  it('rejects CSS injection and incomplete palettes', () => {
    expect(validateThemePalette({ ...ATOMIC_THEME_PALETTE, text: 'url(https://invalid)' })).toEqual(
      { valid: false, message: expect.stringContaining('#RRGGBB') },
    );
    expect(validateThemePalette({ background: '#000000' })).toEqual({
      valid: false,
      message: 'Completa todos los colores del tema.',
    });
  });
});
