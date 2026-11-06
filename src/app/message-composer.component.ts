import { ChangeDetectionStrategy, Component, ElementRef, HostListener, input, output, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EmojiPickerComponent } from './emoji-picker.component';

export function insertTextAtSelection(
  text: string,
  start: number,
  end: number,
  insertion: string,
): { readonly text: string; readonly cursor: number } {
  const safeStart = Math.min(Math.max(0, start), text.length);
  const safeEnd = Math.min(Math.max(safeStart, end), text.length);
  return {
    text: `${text.slice(0, safeStart)}${insertion}${text.slice(safeEnd)}`,
    cursor: safeStart + insertion.length,
  };
}

@Component({
  selector: 'app-message-composer',
  imports: [FormsModule, EmojiPickerComponent],
  templateUrl: './message-composer.component.html',
  styleUrls: ['./message-composer.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageComposerComponent {
  readonly inputName = input.required<string>();
  readonly placeholder = input.required<string>();
  readonly draft = input.required<string>();
  readonly disabled = input(false);
  readonly showAttach = input(false);
  readonly showEmoji = input(false);
  readonly stickersAccountId = input('');
  readonly draftChange = output<string>();
  readonly inputFocus = output<void>();
  readonly inputBlur = output<void>();
  readonly messageSubmitted = output<void>();
  readonly stickerSend = output<string>();
  readonly attach = output<void>();
  readonly filesPasted = output<ReadonlyArray<File>>();
  protected readonly emojiOpen = signal(false);
  @ViewChild('messageInput') private messageInput?: ElementRef<HTMLTextAreaElement>;
  private savedSelection = { start: 0, end: 0 };

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  protected toggleEmoji(): void {
    if (this.disabled()) return;
    this.saveSelection();
    this.emojiOpen.update((open) => !open);
  }

  protected insertEmoji(emoji: string): void {
    const inserted = insertTextAtSelection(this.draft(), this.savedSelection.start, this.savedSelection.end, emoji);
    this.draftChange.emit(inserted.text);
    this.savedSelection = { start: inserted.cursor, end: inserted.cursor };
    this.emojiOpen.set(false);
    queueMicrotask(() => {
      const input = this.messageInput?.nativeElement;
      if (!input) return;
      input.focus();
      input.setSelectionRange(this.savedSelection.start, this.savedSelection.end);
    });
  }

  protected closeEmoji(): void { this.emojiOpen.set(false); }
  protected saveSelection(): void {
    const input = this.messageInput?.nativeElement;
    if (input) this.savedSelection = { start: input.selectionStart || 0, end: input.selectionEnd || 0 };
  }
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (this.draft().trim()) this.messageSubmitted.emit();
    }
  }
  @HostListener('paste', ['$event'])
  protected onPaste(event: ClipboardEvent): void {
    if (this.disabled()) return;
    const files = clipboardFiles(event);
    if (!files.length) return;
    event.preventDefault();
    this.filesPasted.emit(files);
  }
  protected resizeInput(): void {
    const input = this.messageInput?.nativeElement;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerdown(event: PointerEvent): void {
    if (!this.emojiOpen() || this.host.nativeElement.contains(event.target as Node)) return;
    this.emojiOpen.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (this.emojiOpen() && event.key === 'Escape' && !event.isComposing) {
      event.preventDefault();
      this.emojiOpen.set(false);
      this.messageInput?.nativeElement.focus();
    }
  }
}

export function clipboardFiles(event: ClipboardEvent): ReadonlyArray<File> {
  const data = event.clipboardData;
  if (!data) return [];
  const files = new Set<File>(Array.from(data.files));
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.add(file);
  }
  return [...files];
}
