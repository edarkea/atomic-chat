import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { MessageItemComponent, emojiOnlyCount, messageContentSegments } from './message-item.component';
import { EXTERNAL_LINK_PORT } from './core/ports';

describe('message links', () => {
  it('counts emoji-only messages without treating text as an emoji', () => {
    expect(emojiOnlyCount('😀')).toBe(1);
    expect(emojiOnlyCount('😎😎')).toBe(2);
    expect(emojiOnlyCount('😂 😂 😂')).toBe(3);
    expect(emojiOnlyCount('👩🏽‍💻')).toBe(1);
    expect(emojiOnlyCount('©')).toBe(0);
    expect(emojiOnlyCount('Hola 😎')).toBe(0);
    expect(emojiOnlyCount('😂😂😂😂')).toBe(4);
  });

  it('segments safe HTTP links while preserving surrounding text', () => {
    expect(messageContentSegments('Visita https://example.test/path.')).toEqual([
      { kind: 'text', value: 'Visita ' },
      { kind: 'link', value: 'https://example.test/path', href: 'https://example.test/path' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('asks for confirmation before opening a link through the external-link port', async () => {
    const open = vi.fn(async () => ({ ok: true as const, version: 1 as const, requestId: 'link', value: undefined }));
    await TestBed.configureTestingModule({
      imports: [MessageItemComponent],
      providers: [{ provide: EXTERNAL_LINK_PORT, useValue: { open } }],
    }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> = TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'contact@example.test');
    fixture.componentRef.setInput('body', 'https://example.test/notice');
    fixture.componentRef.setInput('outgoing', false);
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.message-link') as HTMLAnchorElement).click();
    expect(confirmation).toHaveBeenCalledWith(expect.stringContaining('https://example.test/notice'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.test/notice' }));
    confirmation.mockRestore();
  });

  it('applies the large-emoji classes only for one to three emoji-only messages', async () => {
    await TestBed.configureTestingModule({ imports: [MessageItemComponent] }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> = TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'contact@example.test');
    fixture.componentRef.setInput('body', '😀');
    fixture.componentRef.setInput('outgoing', false);
    fixture.detectChanges();
    const body = fixture.nativeElement.querySelector('.message-body') as HTMLElement;
    expect(body.classList.contains('emoji-only-single')).toBe(true);
    expect(body.classList.contains('emoji-only-double')).toBe(false);

    fixture.componentRef.setInput('body', 'Hola 😎');
    fixture.detectChanges();
    expect(body.classList.contains('emoji-only-single')).toBe(false);
  });

  it('keeps hover controls compact and emits quick reactions and menu actions', async () => {
    await TestBed.configureTestingModule({ imports: [MessageItemComponent] }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> = TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'contact@example.test');
    fixture.componentRef.setInput('body', 'Hola');
    fixture.componentRef.setInput('outgoing', false);
    fixture.componentRef.setInput('messageId', 'wire-1');
    const overlays: Array<'quick' | 'menu' | 'picker' | undefined> = [];
    const reactions: ReadonlyArray<string>[] = [];
    fixture.componentInstance.overlayRequested.subscribe((value) => overlays.push(value));
    fixture.componentInstance.reactionChanged.subscribe((value) => reactions.push(value));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('.message-action--compact')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('.message-action--emoji')).toHaveLength(0);
    (fixture.nativeElement.querySelector('.message-action--compact') as HTMLButtonElement).click();
    expect(overlays.at(-1)).toBe('quick');

    fixture.componentRef.setInput('activeOverlay', 'quick');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.message-action--emoji')).toHaveLength(6);
    (fixture.nativeElement.querySelector('.message-action--emoji') as HTMLButtonElement).click();
    expect(reactions.at(-1)).toEqual(['👍']);

    fixture.componentRef.setInput('activeOverlay', 'menu');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    fixture.nativeElement.querySelector('article').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlays.at(-1)).toBeUndefined();
  });
});
