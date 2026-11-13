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

export const ATOMIC_LIGHT_THEME_PALETTE: ThemePalette = Object.freeze({
  background: '#F2F8F1',
  surface: '#E8F2E8',
  surfaceRaised: '#DCECDD',
  accent: '#186A38',
  text: '#14301D',
  textSecondary: '#365D42',
  border: '#6C9273',
  incomingBubble: '#D7E8DB',
  outgoingBubble: '#BFE1C6',
  focus: '#155E31',
});

export interface ThemeOption {
  readonly id: ThemeId;
  readonly label: string;
}

export const THEME_OPTIONS: ReadonlyArray<ThemeOption> = Object.freeze([
  { id: 'atomic', label: 'Wasteland Terminal' },
  { id: 'atomic-light', label: 'Wasteland Terminal Claro' },
  { id: 'custom', label: 'Personalizado' },
]);

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

const CUSTOM_ALIAS_VARIABLES: Readonly<Record<string, ThemeColorKey>> = {
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

const SEMANTIC_VARIABLES: Readonly<Record<string, string>> = {
  '--atomic-success': '#54e777',
  '--atomic-warning': '#ffe0a2',
  '--atomic-warning-strong': '#d19a4a',
  '--atomic-danger': '#ffb4b4',
  '--atomic-danger-surface': '#3d1c1c',
};

const LIGHT_SEMANTIC_VARIABLES: Readonly<Record<string, string>> = {
  '--atomic-success': '#1f7a4d',
  '--atomic-warning': '#8a5a00',
  '--atomic-warning-strong': '#9a6500',
  '--atomic-danger': '#b42318',
  '--atomic-danger-surface': '#fce8e6',
};

const PRESET_PALETTES: Readonly<Record<'atomic' | 'atomic-light', ThemePalette>> = Object.freeze({
  atomic: ATOMIC_THEME_PALETTE,
  'atomic-light': ATOMIC_LIGHT_THEME_PALETTE,
});
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}(?:[0-9a-f]{2})?)$/i;
const COLOR_FUNCTION =
  /^(?:rgba?|hsla?)\(\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?(?:\s*(?:,|\/)\s*|\s+)[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?(?:\s*(?:,|\/)\s*|\s+)[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?(?:\s*(?:,|\/)\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)%?)?\s*\)$/i;
const TRANSPARENT_COLOR = /^transparent$/i;

export interface ThemeValidation {
  readonly valid: boolean;
  readonly message?: string;
}

function parseNumber(value: string, max: number, percentageAllowed: boolean): number | null {
  const isPercentage = value.endsWith('%');
  if (isPercentage && !percentageAllowed) return null;
  const numeric = Number.parseFloat(isPercentage ? value.slice(0, -1) : value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > (isPercentage ? 100 : max)) return null;
  return isPercentage ? (numeric / 100) * max : numeric;
}

function parseColor(value: string): readonly [number, number, number] | null {
  const normalized = value.trim();
  if (TRANSPARENT_COLOR.test(normalized)) return [0, 0, 0];
  if (HEX_COLOR.test(normalized)) {
    const compact = normalized.slice(1);
    const expanded =
      compact.length <= 4
        ? compact
            .split('')
            .map((channel) => channel + channel)
            .join('')
        : compact;
    return [
      Number.parseInt(expanded.slice(0, 2), 16),
      Number.parseInt(expanded.slice(2, 4), 16),
      Number.parseInt(expanded.slice(4, 6), 16),
    ];
  }
  const match = normalized.match(/^(rgba?|hsla?)\((.*)\)$/i);
  if (!match || !COLOR_FUNCTION.test(normalized)) return null;
  const components = match[2].replace(/,/g, ' ').replace(/\//g, ' ').trim().split(/\s+/);
  if (components.length < 3 || components.length > 4) return null;
  const kind = match[1].toLowerCase();
  if (kind.startsWith('rgb')) {
    const channels = components.slice(0, 3).map((component) => parseNumber(component, 255, true));
    if (channels.some((channel) => channel === null)) return null;
    if (components[3] !== undefined && parseNumber(components[3], 1, true) === null) return null;
    return [channels[0]!, channels[1]!, channels[2]!];
  }
  if (!components[1].endsWith('%') || !components[2].endsWith('%')) return null;
  const hue = Number.parseFloat(components[0]);
  const saturation = parseNumber(components[1], 100, true);
  const lightness = parseNumber(components[2], 100, true);
  if (!Number.isFinite(hue) || saturation === null || lightness === null) return null;
  if (components[3] !== undefined && parseNumber(components[3], 1, true) === null) return null;
  const h = ((hue % 360) + 360) / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hueToRgb = (p: number, q: number, t: number): number => {
    const adjusted = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (adjusted < 1 / 6) return p + (q - p) * 6 * adjusted;
    if (adjusted < 1 / 2) return q;
    if (adjusted < 2 / 3) return p + (q - p) * (2 / 3 - adjusted) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    hueToRgb(p, q, h + 1 / 3) * 255,
    hueToRgb(p, q, h) * 255,
    hueToRgb(p, q, h - 1 / 3) * 255,
  ];
}

function isThemeColor(value: string): value is HexColor {
  return (
    typeof value === 'string' &&
    (HEX_COLOR.test(value.trim()) ||
      COLOR_FUNCTION.test(value.trim()) ||
      TRANSPARENT_COLOR.test(value.trim())) &&
    parseColor(value) !== null
  );
}

export function isThemeId(value: string): value is ThemeId {
  return value === 'atomic' || value === 'atomic-light' || value === 'custom';
}

export function normalizeThemeId(value: unknown): ThemeId {
  if (value === 'dark') return 'atomic';
  if (value === 'light') return 'atomic-light';
  return typeof value === 'string' && isThemeId(value) ? value : 'atomic';
}

function luminance(value: HexColor): number {
  const rgb = parseColor(value) ?? [0, 0, 0];
  const channels = rgb.map((channel) => channel / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function validateThemePalette(value: Readonly<Record<string, string>>): ThemeValidation {
  const keys = Object.keys(value);
  if (
    keys.length !== THEME_COLOR_FIELDS.length ||
    THEME_COLOR_FIELDS.some(({ key }) => !keys.includes(key))
  )
    return { valid: false, message: 'Completa todos los colores del tema.' };
  for (const { key, label } of THEME_COLOR_FIELDS)
    if (!isThemeColor(value[key]))
      return {
        valid: false,
        message: `${label} debe usar un color válido (#RGB, #RRGGBB, rgb(), rgba(), hsl() o hsla()).`,
      };

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

function paletteFor(theme: ThemeId, customPalette: ThemePalette | null): ThemePalette {
  return theme === 'custom' ? (customPalette ?? ATOMIC_THEME_PALETTE) : PRESET_PALETTES[theme];
}

interface CommittedTheme {
  readonly themeId: ThemeId;
  readonly customPalette: ThemePalette | null;
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly preferencesPort = inject<PreferencesPort | null>(PREFERENCES_PORT, {
    optional: true,
  });
  private initialization?: Promise<void>;
  private readonly customPalette = signal<ThemePalette | null>(null);
  private committedTheme: CommittedTheme = { themeId: 'atomic', customPalette: null };
  private persistenceQueue: Promise<void> = Promise.resolve();
  private persistenceSequence = 0;
  private pendingSaves = 0;

  readonly themeId = signal<ThemeId>('atomic');
  readonly activePalette = computed<ThemePalette>(() =>
    paletteFor(this.themeId(), this.customPalette()),
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
    return this.persistTheme('custom', palette, true);
  }

  async selectTheme(theme: ThemeId): Promise<boolean> {
    if (theme === 'custom') {
      const palette = this.customPalette();
      if (!palette) {
        this.openStudio();
        return false;
      }
      return this.persistTheme(theme, palette);
    }
    return this.persistTheme(theme);
  }

  async restoreOriginal(): Promise<boolean> {
    return this.persistTheme('atomic', ATOMIC_THEME_PALETTE, true, true);
  }

  resetPreferences(): void {
    this.persistenceSequence += 1;
    this.committedTheme = { themeId: 'atomic', customPalette: null };
    this.customPalette.set(null);
    this.themeId.set('atomic');
    this.draftPalette.set(copyPalette(ATOMIC_THEME_PALETTE));
    this.persistenceError.set(null);
    this.validationError.set(null);
    this.editorOpen.set(false);
    this.applyCss('atomic', ATOMIC_THEME_PALETTE);
  }

  private async persistTheme(
    theme: ThemeId,
    customPalette?: ThemePalette,
    persistCustomPalette = false,
    resetCustomPalette = false,
  ): Promise<boolean> {
    const palette = theme === 'custom' ? customPalette : paletteFor(theme, this.customPalette());
    if (!palette) {
      this.persistenceError.set('No existe una paleta personalizada guardada.');
      return false;
    }
    const sequence = ++this.persistenceSequence;
    const target: CommittedTheme = {
      themeId: theme,
      customPalette: resetCustomPalette
        ? ATOMIC_THEME_PALETTE
        : theme === 'custom'
          ? palette
          : this.customPalette(),
    };
    this.pendingSaves += 1;
    this.saving.set(true);
    this.validationError.set(null);
    this.persistenceError.set(null);
    this.customPalette.set(target.customPalette);
    this.themeId.set(theme);
    this.draftPalette.set(copyPalette(palette));
    this.applyCss(theme, palette);
    if (!this.preferencesPort) {
      this.restoreCommittedTheme();
      this.persistenceError.set('El almacenamiento de preferencias no está disponible.');
      this.pendingSaves -= 1;
      this.saving.set(this.pendingSaves > 0);
      return false;
    }
    const preferencesPort = this.preferencesPort;
    const save = async (): Promise<boolean> => {
      try {
        if (sequence !== this.persistenceSequence) return false;
        const changes: Partial<Preferences> = persistCustomPalette
          ? { theme, customTheme: target.customPalette ?? ATOMIC_THEME_PALETTE }
          : { theme };
        const result = await preferencesPort.update({ accountId: '', changes });
        if (!result.ok) {
          if (sequence === this.persistenceSequence) {
            this.restoreCommittedTheme();
            this.persistenceError.set(result.error.message);
          }
          return false;
        }
        this.committedTheme = target;
        if (sequence === this.persistenceSequence) this.editorOpen.set(false);
        return true;
      } catch {
        if (sequence === this.persistenceSequence) {
          this.restoreCommittedTheme();
          this.persistenceError.set(
            'No fue posible guardar el tema. Conservé el último tema válido.',
          );
        }
        return false;
      } finally {
        this.pendingSaves -= 1;
        this.saving.set(this.pendingSaves > 0);
      }
    };
    const operation = this.persistenceQueue.then(save, save);
    this.persistenceQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async loadStoredTheme(): Promise<void> {
    this.applyCss('atomic', ATOMIC_THEME_PALETTE);
    if (!this.preferencesPort) return;
    try {
      const result = await this.preferencesPort.get({ accountId: '' });
      if (!result.ok) {
        this.persistenceError.set(result.error.message);
        return;
      }
      const palette = isThemePalette(result.value.customTheme) ? result.value.customTheme : null;
      if (result.value.customTheme !== undefined && !palette)
        this.persistenceError.set('La paleta personalizada guardada no es válida.');
      const theme = normalizeThemeId(result.value.theme);
      if (theme === 'custom' && !palette) {
        this.themeId.set('atomic');
        this.draftPalette.set(copyPalette(ATOMIC_THEME_PALETTE));
        this.applyCss('atomic', ATOMIC_THEME_PALETTE);
        this.persistenceError.set('El tema guardado no es válido; se aplicó Wasteland Terminal.');
        return;
      }
      this.customPalette.set(palette);
      this.themeId.set(theme);
      this.draftPalette.set(copyPalette(paletteFor(theme, palette)));
      this.applyCss(theme, paletteFor(theme, palette));
      this.committedTheme = { themeId: theme, customPalette: palette };
    } catch {
      this.persistenceError.set('No fue posible cargar el tema; se aplicó Wasteland Terminal.');
    }
  }

  private restoreCommittedTheme(): void {
    const { themeId, customPalette } = this.committedTheme;
    const palette = paletteFor(themeId, customPalette);
    this.customPalette.set(customPalette);
    this.themeId.set(themeId);
    this.draftPalette.set(copyPalette(palette));
    this.applyCss(themeId, palette);
  }

  private applyCss(theme: ThemeId, palette: ThemePalette): void {
    const root = this.document.documentElement;
    const scheme =
      theme === 'atomic-light' || (theme === 'custom' && luminance(palette.background) > 0.5)
        ? 'light'
        : 'dark';
    root.style.setProperty('color-scheme', scheme);
    for (const variable of Object.values(CSS_VARIABLES)) root.style.removeProperty(variable);
    for (const variable of Object.keys(CUSTOM_ALIAS_VARIABLES)) root.style.removeProperty(variable);
    for (const variable of Object.keys(SEMANTIC_VARIABLES)) root.style.removeProperty(variable);
    if (theme === 'atomic') return;
    for (const [key, variable] of Object.entries(CSS_VARIABLES))
      root.style.setProperty(variable, palette[key as ThemeColorKey]);
    for (const [variable, key] of Object.entries(CUSTOM_ALIAS_VARIABLES))
      root.style.setProperty(variable, palette[key]);
    if (theme !== 'custom') {
      const semantic =
        luminance(palette.background) > 0.5 ? LIGHT_SEMANTIC_VARIABLES : SEMANTIC_VARIABLES;
      for (const [variable, value] of Object.entries(semantic))
        root.style.setProperty(variable, value);
    }
  }
}
