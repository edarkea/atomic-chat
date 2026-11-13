import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  clipboardFiles,
  insertTextAtSelection,
  MessageComposerComponent,
} from './message-composer.component';

describe('composer height after sending', () => {
  async function expandedComposer() {
    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('inputName', 'message');
    fixture.componentRef.setInput('placeholder', 'Escribir mensaje…');
    fixture.componentRef.setInput('draft', 'Primera línea\nSegunda línea\nTercera línea');
    fixture.detectChanges();
    await fixture.whenStable();
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    // jsdom has no layout engine; simulate content exceeding the height limit.
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, get: () => 160 });
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(textarea.style.height).toBe('120px');
    expect(textarea.style.overflowY).toBe('auto');
    return { fixture, textarea };
  }

  it('restores the one-row height when the parent clears an accepted message', async () => {
    const { fixture, textarea } = await expandedComposer();
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.value).toBe('');
    expect(textarea.rows).toBe(1);
    expect(textarea.style.height).toBe('');
    expect(textarea.style.overflowY).toBe('hidden');
  });

  it('keeps the draft and height while sending or after a rejected send', async () => {
    const { fixture, textarea } = await expandedComposer();
    const draft = textarea.value;
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentRef.setInput('disabled', false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.value).toBe(draft);
    expect(textarea.style.height).toBe('120px');
  });
});

describe('stacked reply composer', () => {
  it('places the reply preview above the input row and preserves the draft on cancel', () => {
    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('inputName', 'message');
    fixture.componentRef.setInput('placeholder', 'Escribir mensaje…');
    fixture.componentRef.setInput('draft', 'borrador conservado');
    fixture.componentRef.setInput('showAttach', true);
    fixture.componentRef.setInput('showEmoji', true);
    fixture.componentRef.setInput('replyPreview', {
      author: 'Barbara',
      quote: 'Una cita larga con emojis 👩🏽‍💻',
    });
    const cancelled = vi.fn();
    fixture.componentInstance.replyCancel.subscribe(cancelled);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.reply-preview')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.composer-input-row')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.composer-input-row textarea')).toBeTruthy();
    expect(fixture.nativeElement.textContent).not.toContain('Respondiendo a');
    expect(fixture.nativeElement.textContent).toContain('Barbara');
    expect(fixture.nativeElement.textContent).toContain('Una cita larga con emojis 👩🏽‍💻');

    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Cancelar respuesta"]',
      ) as HTMLButtonElement
    ).click();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.draft()).toBe('borrador conservado');
  });

  it('keeps the compact input row when no reply is active', () => {
    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('inputName', 'message');
    fixture.componentRef.setInput('placeholder', 'Escribir mensaje…');
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.reply-preview')).toBeNull();
    expect(fixture.nativeElement.querySelector('.composer-input-row')).toBeTruthy();
  });
});

describe('insertTextAtSelection', () => {
  it('inserts a complex Unicode sequence without fragmenting it', () => {
    const result = insertTextAtSelection('hola mundo', 5, 5, '👩🏽‍💻');
    expect(result.text).toBe('hola 👩🏽‍💻mundo');
    expect(result.cursor).toBe(5 + '👩🏽‍💻'.length);
  });

  it('replaces the selected range and preserves the remaining text', () => {
    const result = insertTextAtSelection('uno dos tres', 4, 7, '✅');
    expect(result.text).toBe('uno ✅ tres');
  });
});

describe('emoji picker visibility', () => {
  function createEmojiComposer() {
    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('inputName', 'message');
    fixture.componentRef.setInput('placeholder', 'Escribir mensaje…');
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('showEmoji', true);
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the picker open while inserting multiple emojis', async () => {
    const fixture = createEmojiComposer();
    const toggle = fixture.nativeElement.querySelector(
      'button[aria-label="Insertar emoji"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    const emojiButtons = fixture.nativeElement.querySelectorAll(
      '.emoji-grid button',
    ) as NodeListOf<HTMLButtonElement>;
    emojiButtons[0].click();
    fixture.componentRef.setInput('draft', '😀');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-emoji-picker')).toBeTruthy();

    const nextEmojiButtons = fixture.nativeElement.querySelectorAll(
      '.emoji-grid button',
    ) as NodeListOf<HTMLButtonElement>;
    nextEmojiButtons[1].click();
    fixture.componentRef.setInput('draft', '😀😂');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-emoji-picker')).toBeTruthy();
  });

  it('closes from the picker close button or a click outside the composer', () => {
    const fixture = createEmojiComposer();
    const toggle = fixture.nativeElement.querySelector(
      'button[aria-label="Insertar emoji"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Cerrar selector de emojis"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-emoji-picker')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-emoji-picker')).toBeNull();
  });

  it('closes the picker when a message is submitted', () => {
    const fixture = createEmojiComposer();
    fixture.componentRef.setInput('draft', '😀');
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Insertar emoji"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-emoji-picker')).toBeTruthy();

    const submitted = vi.fn();
    fixture.componentInstance.messageSubmitted.subscribe(submitted);
    (fixture.nativeElement.querySelector('button.send') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(submitted).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('app-emoji-picker')).toBeNull();
  });
});

describe('emoji picker recents', () => {
  it('keeps the recent grid stable until the picker is opened again', () => {
    localStorage.removeItem('atomic-chat.recent-emojis.v1');
    const first = TestBed.createComponent(MessageComposerComponent);
    first.componentRef.setInput('inputName', 'message');
    first.componentRef.setInput('placeholder', 'Escribir mensaje…');
    first.componentRef.setInput('draft', '');
    first.componentRef.setInput('showEmoji', true);
    first.detectChanges();
    (
      first.nativeElement.querySelector('button[aria-label="Insertar emoji"]') as HTMLButtonElement
    ).click();
    first.detectChanges();

    const emoji = first.nativeElement.querySelector('.emoji-grid button') as HTMLButtonElement;
    emoji.click();
    first.detectChanges();
    expect(first.nativeElement.querySelector('.emoji-section--recent')).toBeNull();

    first.destroy();

    const second = TestBed.createComponent(MessageComposerComponent);
    second.componentRef.setInput('inputName', 'message');
    second.componentRef.setInput('placeholder', 'Escribir mensaje…');
    second.componentRef.setInput('draft', '');
    second.componentRef.setInput('showEmoji', true);
    second.detectChanges();
    (
      second.nativeElement.querySelector('button[aria-label="Insertar emoji"]') as HTMLButtonElement
    ).click();
    second.detectChanges();
    expect(second.nativeElement.querySelector('.emoji-section--recent')).toBeTruthy();
  });
});

describe('clipboardFiles', () => {
  it('extracts copied files and images without consuming plain-text paste', () => {
    const file = new File(['image'], 'capture.png', { type: 'image/png' });
    const event = {
      clipboardData: {
        files: [file],
        items: [{ kind: 'file', getAsFile: () => file }],
      },
    } as unknown as ClipboardEvent;
    expect(clipboardFiles(event)).toEqual([file]);
  });

  it('deduplicates equivalent file representations from one clipboard event', () => {
    const first = new File(['image'], 'capture.png', {
      type: 'image/png',
      lastModified: 1234,
    });
    const equivalent = new File(['image'], 'capture.png', {
      type: 'image/png',
      lastModified: 1234,
    });
    const event = {
      clipboardData: {
        files: [first],
        items: [{ kind: 'file', getAsFile: () => equivalent }],
      },
    } as unknown as ClipboardEvent;

    expect(clipboardFiles(event)).toEqual([first]);
  });

  it('uses clipboard files as the authoritative list when item metadata differs', () => {
    const listed = new File(['image'], 'capture.png', {
      type: 'image/png',
      lastModified: 1234,
    });
    const itemRepresentation = new File(['image'], 'capture.png', {
      type: 'image/png',
      lastModified: 0,
    });
    const event = {
      clipboardData: {
        files: [listed],
        items: [{ kind: 'file', getAsFile: () => itemRepresentation }],
      },
    } as unknown as ClipboardEvent;

    expect(clipboardFiles(event)).toEqual([listed]);
  });
});

describe('clipboard paste deduplication', () => {
  function pasteEvent(file: File): ClipboardEvent {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        files: [file],
        items: [{ kind: 'file', getAsFile: () => file }],
      },
    });
    return event as ClipboardEvent;
  }

  it('ignores equivalent paste events for 800 ms and accepts them afterwards', () => {
    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('inputName', 'message');
    fixture.componentRef.setInput('placeholder', 'Escribir mensaje…');
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();
    const emitted: ReadonlyArray<File>[] = [];
    fixture.componentInstance.filesPasted.subscribe((files) => emitted.push(files));
    const onPaste = (
      fixture.componentInstance as unknown as {
        onPaste: (event: ClipboardEvent) => void;
      }
    ).onPaste.bind(fixture.componentInstance);
    const now = vi.spyOn(Date, 'now');
    const file = new File(['image'], 'capture.png', { type: 'image/png', lastModified: 1234 });

    now.mockReturnValue(1000);
    const first = pasteEvent(file);
    onPaste(first);
    now.mockReturnValue(1500);
    const repeated = pasteEvent(
      new File(['image'], 'capture.png', { type: 'image/png', lastModified: 1234 }),
    );
    onPaste(repeated);
    now.mockReturnValue(1801);
    const accepted = pasteEvent(
      new File(['image'], 'capture.png', { type: 'image/png', lastModified: 1234 }),
    );
    onPaste(accepted);
    now.mockRestore();

    expect(emitted).toHaveLength(2);
    expect(first.defaultPrevented).toBe(true);
    expect(repeated.defaultPrevented).toBe(true);
    expect(accepted.defaultPrevented).toBe(true);
  });

  it('does not block plain-text paste', () => {
    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('inputName', 'message');
    fixture.componentRef.setInput('placeholder', 'Escribir mensaje…');
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();
    const onPaste = (
      fixture.componentInstance as unknown as {
        onPaste: (event: ClipboardEvent) => void;
      }
    ).onPaste.bind(fixture.componentInstance);
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: { files: [], items: [{ kind: 'string' }] },
    });

    onPaste(event as ClipboardEvent);

    expect(event.defaultPrevented).toBe(false);
  });
});
