import { TestBed } from '@angular/core/testing';
import { clipboardFiles, insertTextAtSelection, MessageComposerComponent } from './message-composer.component';

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
});
