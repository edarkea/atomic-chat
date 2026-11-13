import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  applySkinTone,
  EMOJI_CATALOG,
  findEmojiEntry,
  matchesEmojiSearch,
  SKIN_TONE_OPTIONS,
  type EmojiEntry,
  type SkinToneModifier,
} from './emoji-catalog';

const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  Todos: 'ac-emoji-category-all',
  Caras: 'ac-emoji',
  Gestos: 'ac-emoji-category-gestures',
  Símbolos: 'ac-emoji-category-symbols',
  Objetos: 'ac-emoji-category-objects',
  Personas: 'ac-contact',
  'Animales y naturaleza': 'ac-emoji-category-nature',
  'Comida y bebida': 'ac-emoji-category-food',
  'Deportes y ocio': 'ac-emoji-category-sports',
  'Viajes y lugares': 'ac-emoji-category-travel',
  'Tecnología y objetos': 'ac-emoji-category-tech',
  Banderas: 'ac-emoji-category-flags',
};
const RECENTS_KEY = 'atomic-chat.recent-emojis.v1';

interface RecentEmojiEntry {
  readonly emoji: string;
  readonly entry: EmojiEntry;
}

@Component({
  selector: 'app-emoji-picker',
  imports: [FormsModule],
  templateUrl: './emoji-picker.component.html',
  styleUrls: ['./emoji-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmojiPickerComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly disabled = input(false);
  readonly emojiSelected = output<string>();
  readonly closed = output<void>();
  protected readonly query = signal('');
  protected readonly category = signal('Todos');
  protected readonly skinTone = signal<SkinToneModifier>('');
  protected readonly skinToneOptions = SKIN_TONE_OPTIONS;
  protected readonly recent = signal<ReadonlyArray<string>>(this.readRecent());
  protected readonly categories = [
    'Todos',
    ...new Set(EMOJI_CATALOG.map((entry) => entry.category)),
  ];
  protected readonly categorySections = this.categories.slice(1);
  protected readonly entriesByCategory = computed(() => {
    const query = this.query();
    return new Map(
      this.categorySections.map((category) => [
        category,
        EMOJI_CATALOG.filter(
          (entry) => entry.category === category && matchesEmojiSearch(entry, query),
        ),
      ]),
    );
  });
  protected categoryIcon(category: string): string {
    return CATEGORY_ICONS[category] || '•';
  }
  protected readonly visible = computed(() => {
    return [...this.entriesByCategory().values()].flat();
  });
  protected readonly recentEntries = computed(() =>
    this.recent()
      .map((emoji): RecentEmojiEntry | null => {
        const entry = findEmojiEntry(emoji);
        return entry ? { emoji, entry } : null;
      })
      .filter((entry): entry is RecentEmojiEntry => entry !== null),
  );
  private pendingRecent: ReadonlyArray<string> = [];
  protected readonly showRecentSection = computed(
    () => this.recentEntries().length > 0 && !this.query().trim(),
  );

  constructor() {
    this.pendingRecent = [...this.recent()];
    afterNextRender(() => this.focusSearch());
    inject(DestroyRef).onDestroy(() => this.persistRecent());
  }

  protected choose(entry: EmojiEntry): void {
    const emoji = this.emojiFor(entry);
    this.rememberRecent(emoji);
    this.emojiSelected.emit(emoji);
  }

  protected chooseRecent(emoji: string): void {
    if (!findEmojiEntry(emoji)) return;
    this.rememberRecent(emoji);
    this.emojiSelected.emit(emoji);
  }

  protected selectSkinTone(modifier: string): void {
    const option = SKIN_TONE_OPTIONS.find((candidate) => candidate.modifier === modifier);
    if (option) this.skinTone.set(option.modifier);
  }

  protected emojiFor(entry: EmojiEntry): string {
    return entry.supportsSkinTone ? applySkinTone(entry.emoji, this.skinTone()) : entry.emoji;
  }

  private rememberRecent(emoji: string): void {
    this.pendingRecent = [
      emoji,
      ...this.pendingRecent.filter((recentEmoji) => recentEmoji !== emoji),
    ].slice(0, 12);
  }

  protected selectCategory(category: string): void {
    this.category.set(category);
    if (this.query().trim()) this.query.set('');
    queueMicrotask(() => this.scrollToCategory(category));
  }

  protected categoryId(category: string): string {
    const normalized = category
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase('es')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '');
    return 'emoji-category-' + (normalized || 'all');
  }

  protected onCategoryKeydown(event: KeyboardEvent, index: number): void {
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex += 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex -= 1;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = this.categories.length - 1;
    else return;

    event.preventDefault();
    const categoryCount = this.categories.length;
    nextIndex = (nextIndex + categoryCount) % categoryCount;
    const root = this.host.nativeElement as HTMLElement;
    const buttons = root.querySelectorAll(
      '.emoji-categories button',
    ) as NodeListOf<HTMLButtonElement>;
    const button = buttons.item(nextIndex);
    button?.focus();
    if (button) this.selectCategory(this.categories[nextIndex]);
  }

  protected onPickerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.closed.emit();
  }

  private focusSearch(): void {
    const root = this.host.nativeElement as HTMLElement;
    const input = root.querySelector(
      'input[aria-label^="Buscar emoji"]',
    ) as HTMLInputElement | null;
    input?.focus();
  }

  private scrollToCategory(category: string): void {
    const picker = this.host.nativeElement.querySelector('.emoji-picker') as HTMLElement | null;
    if (!picker) return;
    if (category === 'Todos') {
      picker.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const sections = Array.from(picker.querySelectorAll('[data-emoji-category]')) as HTMLElement[];
    const target = sections.find((section) => section.dataset['emojiCategory'] === category);
    if (!target) return;
    picker.scrollTo({
      top: Math.max(0, target.offsetTop - 6),
      behavior: 'smooth',
    });
  }

  private readRecent(): ReadonlyArray<string> {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      return Array.isArray(value)
        ? value
            .filter(
              (item): item is string => typeof item === 'string' && Boolean(findEmojiEntry(item)),
            )
            .slice(0, 12)
        : [];
    } catch {
      return [];
    }
  }

  private persistRecent(): void {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(this.pendingRecent));
    } catch {
      // Local recent emojis are optional and never block message composition.
    }
  }
}
