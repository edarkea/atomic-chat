import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { HexColor, Preferences, ThemeColorKey, ThemeId, ThemePalette } from './domain';
import { PREFERENCES_PORT, PreferencesPort } from './ports';

export interface ThemeColorField {
  readonly key: ThemeColorKey;
  readonly label: string;
}

export type ThemeDraft = Record<ThemeColorKey, string>;

export const ATOMIC_THEME_PALETTE: ThemePalette = Object.freeze({
  background: '#020d07',
  surface: '#03170c',
  surfaceRaised: '#092818',
  accent: '#5ced79',
  text: '#d7f5dc',
  textSecondary: '#a4d5aa',
  border: '#287744',
  incomingBubble: '#0e3a21',
  outgoingBubble: '#267342',
  focus: '#8dffa0',
});

export const THEME_COLOR_FIELDS: ReadonlyArray<ThemeColorField> = Object.freeze([
  { key: 'background', label: 'Fondo principal' },
  { key: 'surface', label: 'Superficie de paneles' },
  { key: 'surfaceRaised', label: 'Superficie elevada' },
  { key: 'accent', label: 'Color de acento' },
  { key: 'text', label: 'Texto principal' },
  { key: 'textSecondary', label: 'Texto secundario' },
  { key: 'border', label: 'Bordes y separadores' },
  { key: 'incomingBubble', label: 'Burbuja recibida' },
  { key: 'outgoingBubble', label: 'Burbuja enviada' },
  { key: 'focus', label: 'Color de enfoque' },
]);

const CSS_VARIABLES: Readonly<Record<ThemeColorKey, string>> = {
  background: '--atomic-bg',
  surface: '--atomic-surface',
  surfaceRaised: '--atomic-surface-raised',
  accent: '--atomic-green',
  text: '--atomic-text',
  textSecondary: '--atomic-text-secondary',
  border: '--atomic-border',
  incomingBubble: '--atomic-bubble-incoming',
  outgoingBubble: '--atomic-bubble-outgoing',
  focus: '--atomic-focus',
};

const CUSTOM_ALIAS_VARIABLES: Readonly<Record<string, string>> = {
  '--atomic-surface-concept': 'surfaceRaised',
  '--atomic-border-avatar': 'border',
  '--atomic-message-outgoing-text': 'text',
  '--atomic-action': 'outgoingBubble',
  '--atomic-action-hover': 'outgoingBubble',
  '--atomic-disabled-surface': 'surface',
  '--atomic-disabled-border': 'border',
  '--atomic-disabled-text': 'textSecondary',
  '--atomic-panel-dialog': 'surface',
  '--atomic-surface-soft': 'surfaceRaised',
  '--atomic-surface-hover': 'surfaceRaised',
  '--atomic-surface-active': 'outgoingBubble',
  '--atomic-green-soft': 'textSecondary',
  '--atomic-green-muted': 'textSecondary',
  '--atomic-text-muted': 'textSecondary',
  '--atomic-border-soft': 'border',
  '--atomic-separator': 'border',
  '--atomic-success': 'accent',
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface ThemeValidation {
  readonly valid: boolean;
  readonly message?: string;
}

function isHexColor(value: string): value is HexColor {
  return HEX_COLOR.test(value);
}

function luminance(value: HexColor): number {
  const channels = [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first: HexColor, second: HexColor): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

export function validateThemePalette(value: Readonly<Record<string, string>>): ThemeValidation {
  const keys = Object.keys(value);
  if (
    keys.length !== THEME_COLOR_FIELDS.length ||
    THEME_COLOR_FIELDS.some(({ key }) => !keys.includes(key))
  )
    return { valid: false, message: 'Completa todos los colores del tema.' };
  for (const { key, label } of THEME_COLOR_FIELDS)
    if (!isHexColor(value[key]))
      return { valid: false, message: `${label} debe usar el formato hexadecimal #RRGGBB.` };

  const textChecks: ReadonlyArray<readonly [ThemeColorKey, ThemeColorKey, string]> = [
    ['text', 'background', 'texto principal sobre el fondo'],
    ['text', 'surface', 'texto principal sobre los paneles'],
    ['text', 'surfaceRaised', 'texto principal sobre superficies elevadas'],
    ['text', 'incomingBubble', 'texto principal sobre mensajes recibidos'],
    ['text', 'outgoingBubble', 'texto principal sobre mensajes enviados'],
    ['textSecondary', 'background', 'texto secundario sobre el fondo'],
    ['textSecondary', 'surface', 'texto secundario sobre los paneles'],
    ['textSecondary', 'incomingBubble', 'texto secundario sobre mensajes recibidos'],
  ];
  for (const [foreground, background, label] of textChecks)
    if (contrast(value[foreground], value[background]) < 4.5)
      return { valid: false, message: `Aumenta el contraste de ${label} (mínimo WCAG AA 4.5:1).` };
  if (contrast(value['textSecondary'], value['outgoingBubble']) < 3)
    return {
      valid: false,
      message: 'Aumenta el contraste del texto secundario sobre mensajes enviados (mínimo 3:1).',
    };

  const controlChecks: ReadonlyArray<readonly [ThemeColorKey, ThemeColorKey, string]> = [
    ['accent', 'background', 'acento sobre el fondo'],
    ['border', 'background', 'bordes sobre el fondo'],
    ['focus', 'background', 'enfoque sobre el fondo'],
  ];
  for (const [foreground, background, label] of controlChecks)
    if (contrast(value[foreground], value[background]) < 3)
      return { valid: false, message: `Aumenta el contraste de ${label} (mínimo 3:1).` };
  return { valid: true };
}

function copyPalette(value: ThemePalette): ThemeDraft {
  return { ...value };
}

function isThemePalette(value: unknown): value is ThemePalette {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return validateThemePalette(candidate as Readonly<Record<string, string>>).valid;
}

function effectivePalette(preferences: Preferences): ThemePalette | null {
  return preferences.theme === 'custom' && isThemePalette(preferences.customTheme)
    ? preferences.customTheme
    : null;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly preferencesPort = inject<PreferencesPort | null>(PREFERENCES_PORT, {
    optional: true,
  });
  private initialization?: Promise<void>;
  private readonly customPalette = signal<ThemePalette | null>(null);

  readonly themeId = signal<ThemeId>('atomic');
  readonly activePalette = computed<ThemePalette>(
    () => this.customPalette() ?? ATOMIC_THEME_PALETTE,
  );
  readonly editorOpen = signal(false);
  readonly draftPalette = signal<ThemeDraft>(copyPalette(ATOMIC_THEME_PALETTE));
  readonly validationError = signal<string | null>(null);
  readonly persistenceError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly fields = THEME_COLOR_FIELDS;

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.loadStoredTheme();
    return this.initialization;
  }

  openStudio(): void {
    this.draftPalette.set(copyPalette(this.activePalette()));
    this.validationError.set(null);
    this.persistenceError.set(null);
    this.editorOpen.set(true);
  }

  setDraftColor(key: ThemeColorKey, value: string): void {
    this.draftPalette.update((palette) => ({ ...palette, [key]: value }));
    this.validationError.set(null);
  }

  cancelStudio(): void {
    this.draftPalette.set(copyPalette(this.activePalette()));
    this.validationError.set(null);
    this.persistenceError.set(null);
    this.editorOpen.set(false);
  }

  async applyDraft(): Promise<boolean> {
    const validation = validateThemePalette(this.draftPalette());
    if (!validation.valid) {
      this.validationError.set(validation.message ?? 'La paleta no es válida.');
      return false;
    }
    const palette = { ...this.draftPalette() } as ThemePalette;
    return this.persistTheme('custom', palette);
  }

  async restoreOriginal(): Promise<boolean> {
    return this.persistTheme('atomic', ATOMIC_THEME_PALETTE);
  }

  private async persistTheme(theme: ThemeId, palette: ThemePalette): Promise<boolean> {
    this.saving.set(true);
    this.validationError.set(null);
    this.persistenceError.set(null);
    if (!this.preferencesPort) {
      this.persistenceError.set('El almacenamiento de preferencias no está disponible.');
      this.saving.set(false);
      return false;
    }
    try {
      const result = await this.preferencesPort.update({
        accountId: '',
        changes: { theme, customTheme: palette },
      });
      if (!result.ok) {
        this.persistenceError.set(result.error.message);
        return false;
      }
      this.customPalette.set(theme === 'custom' ? palette : null);
      this.themeId.set(theme);
      this.draftPalette.set(copyPalette(palette));
      this.applyCss(theme === 'custom' ? palette : null);
      this.editorOpen.set(false);
      return true;
    } catch {
      this.persistenceError.set('No fue posible guardar el tema. Conservé el último tema válido.');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  private async loadStoredTheme(): Promise<void> {
    this.applyCss(null);
    if (!this.preferencesPort) return;
    try {
      const result = await this.preferencesPort.get({ accountId: '' });
      if (!result.ok) {
        this.persistenceError.set(result.error.message);
        return;
      }
      const palette = effectivePalette(result.value);
      if (result.value.theme === 'custom' && !palette) {
        this.persistenceError.set('El tema guardado no es válido; se aplicó Wasteland Terminal.');
        return;
      }
      if (palette) {
        this.customPalette.set(palette);
        this.themeId.set('custom');
        this.draftPalette.set(copyPalette(palette));
        this.applyCss(palette);
      }
    } catch {
      this.persistenceError.set('No fue posible cargar el tema; se aplicó Wasteland Terminal.');
    }
  }

  private applyCss(palette: ThemePalette | null): void {
    const root = this.document.documentElement;
    for (const variable of Object.values(CSS_VARIABLES)) root.style.removeProperty(variable);
    for (const variable of Object.keys(CUSTOM_ALIAS_VARIABLES)) root.style.removeProperty(variable);
    if (!palette) return;
    for (const [key, variable] of Object.entries(CSS_VARIABLES))
      root.style.setProperty(variable, palette[key as ThemeColorKey]);
    for (const [variable, key] of Object.entries(CUSTOM_ALIAS_VARIABLES))
      root.style.setProperty(variable, palette[key as ThemeColorKey]);
  }
}
