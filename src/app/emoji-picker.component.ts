import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface EmojiEntry {
  readonly emoji: string;
  readonly name: string;
  readonly category: string;
}

const EMOJIS: ReadonlyArray<EmojiEntry> = [
  { emoji: '😀', name: 'cara sonrisa', category: 'Caras' },
  { emoji: '😂', name: 'cara lágrimas alegría', category: 'Caras' },
  { emoji: '😍', name: 'cara corazones', category: 'Caras' },
  { emoji: '🤔', name: 'cara pensando', category: 'Caras' },
  { emoji: '😎', name: 'cara gafas', category: 'Caras' },
  { emoji: '😭', name: 'cara llanto', category: 'Caras' },
  { emoji: '😡', name: 'cara enfadado', category: 'Caras' },
  { emoji: '👍', name: 'pulgar arriba', category: 'Gestos' },
  { emoji: '👎', name: 'pulgar abajo', category: 'Gestos' },
  { emoji: '👏', name: 'aplausos', category: 'Gestos' },
  { emoji: '🙏', name: 'manos plegadas gracias', category: 'Gestos' },
  { emoji: '👋', name: 'saludo', category: 'Gestos' },
  { emoji: '❤️', name: 'corazón rojo', category: 'Símbolos' },
  { emoji: '🔥', name: 'fuego', category: 'Símbolos' },
  { emoji: '✨', name: 'brillos', category: 'Símbolos' },
  { emoji: '✅', name: 'correcto', category: 'Símbolos' },
  { emoji: '🎉', name: 'fiesta', category: 'Objetos' },
  { emoji: '🚀', name: 'cohete', category: 'Objetos' },
  { emoji: '💡', name: 'bombilla idea', category: 'Objetos' },
  { emoji: '☕', name: 'café', category: 'Objetos' },
  { emoji: '👩🏽‍💻', name: 'persona programadora tono medio', category: 'Personas' },
  { emoji: '🧑‍🚀', name: 'astronauta', category: 'Personas' },
  { emoji: '🏳️‍🌈', name: 'bandera arcoíris', category: 'Símbolos' },
];
const RECENTS_KEY = 'atomic-chat.recent-emojis.v1';

@Component({
  selector: 'app-emoji-picker',
  imports: [FormsModule],
  templateUrl: './emoji-picker.component.html',
  styleUrls: ['./emoji-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmojiPickerComponent {
  readonly disabled = input(false);
  readonly emojiSelected = output<string>();
  readonly closed = output<void>();
  protected readonly query = signal('');
  protected readonly category = signal('Todos');
  protected readonly recent = signal<ReadonlyArray<string>>(this.readRecent());
  protected readonly categories = ['Todos', ...new Set(EMOJIS.map((entry) => entry.category))];
  protected readonly visible = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const category = this.category();
    return EMOJIS.filter(
      (entry) =>
        (category === 'Todos' || entry.category === category) &&
        (!query || entry.name.toLocaleLowerCase().includes(query) || entry.emoji.includes(query)),
    );
  });
  protected readonly recentEntries = computed(() =>
    this.recent()
      .map((emoji) => EMOJIS.find((entry) => entry.emoji === emoji))
      .filter((entry): entry is EmojiEntry => Boolean(entry)),
  );
  private pendingRecent: ReadonlyArray<string> = [];
  protected readonly showRecentSection = computed(
    () => this.recentEntries().length > 0 && !this.query().trim() && this.category() === 'Todos',
  );

  constructor() {
    this.pendingRecent = [...this.recent()];
    inject(DestroyRef).onDestroy(() => this.persistRecent());
  }

  protected choose(entry: EmojiEntry): void {
    this.pendingRecent = [
      entry.emoji,
      ...this.pendingRecent.filter((emoji) => emoji !== entry.emoji),
    ].slice(0, 12);
    this.emojiSelected.emit(entry.emoji);
  }

  protected chooseRecent(emoji: string): void {
    const entry = EMOJIS.find((candidate) => candidate.emoji === emoji);
    if (entry) this.choose(entry);
  }

  private readRecent(): ReadonlyArray<string> {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && EMOJIS.some((entry) => entry.emoji === item)).slice(0, 12)
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
