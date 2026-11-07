import { ChangeDetectionStrategy, Component, effect, ElementRef, HostListener, input, output, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EmojiPickerComponent } from './emoji-picker.component';

const CLIPBOARD_FILE_DEDUPLICATION_WINDOW_MS = 800;

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
  readonly replyPreview = input<{ readonly author: string; readonly quote: string }>();
  readonly draftChange = output<string>();
  readonly inputFocus = output<void>();
  readonly inputBlur = output<void>();
  readonly messageSubmitted = output<void>();
  readonly stickerSend = output<string>();
  readonly attach = output<void>();
  readonly filesPasted = output<ReadonlyArray<File>>();
  readonly replyCancel = output<void>();
  protected readonly emojiOpen = signal(false);
  @ViewChild('messageInput') private messageInput?: ElementRef<HTMLTextAreaElement>;
  private savedSelection = { start: 0, end: 0 };
  private readonly processedPasteEvents = new WeakSet<ClipboardEvent>();
  private lastClipboardPaste?: { readonly key: string; readonly timestamp: number };

  constructor(private readonly host: ElementRef<HTMLElement>) {
    effect(() => {
      if (this.draft()) return;
      const input = this.messageInput?.nativeElement;
      if (!input) return;
      input.style.removeProperty('height');
      input.style.overflowY = 'hidden';
    });
  }

  protected toggleEmoji(): void {
    if (this.disabled()) return;
    this.saveSelection();
    this.emojiOpen.update((open) => !open);
  }

  protected insertEmoji(emoji: string): void {
    const inserted = insertTextAtSelection(this.draft(), this.savedSelection.start, this.savedSelection.end, emoji);
    this.draftChange.emit(inserted.text);
    this.savedSelection = { start: inserted.cursor, end: inserted.cursor };
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
      this.submitMessage();
    }
  }
  protected submitMessage(): void {
    if (this.disabled() || !this.draft().trim()) return;
    this.emojiOpen.set(false);
    this.messageSubmitted.emit();
  }
  @HostListener('paste', ['$event'])
  protected onPaste(event: ClipboardEvent): void {
    if (this.disabled()) return;
    const files = clipboardFiles(event);
    if (!files.length) return;
    if (this.processedPasteEvents.has(event)) {
      event.preventDefault();
      return;
    }
    this.processedPasteEvents.add(event);
    const key = clipboardFilesKey(files);
    const now = Date.now();
    if (
      this.lastClipboardPaste?.key === key &&
      now - this.lastClipboardPaste.timestamp < CLIPBOARD_FILE_DEDUPLICATION_WINDOW_MS
    ) {
      event.preventDefault();
      return;
    }
    this.lastClipboardPaste = { key, timestamp: now };
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

}

export function clipboardFiles(event: ClipboardEvent): ReadonlyArray<File> {
  const data = event.clipboardData;
  if (!data) return [];
  // Chromium may expose the same clipboard file through both collections, with
  // different metadata. Prefer the complete FileList and use items only as fallback.
  const files = Array.from(data.files);
  if (files.length) return files;
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = clipboardFileKey(file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clipboardFileKey(file: File): string {
  return [file.name, file.size, file.type, file.lastModified, file.webkitRelativePath].join('\u001f');
}

function clipboardFilesKey(files: ReadonlyArray<File>): string {
  return files.map(clipboardFileKey).sort().join('\u001e');
}
