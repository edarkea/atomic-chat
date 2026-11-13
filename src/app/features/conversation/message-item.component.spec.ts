import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  isProtectedMessageOverlayPointer,
  MessageItemComponent,
  emojiOnlyCount,
  messageContentSegments,
} from './message-item.component';
import { EXTERNAL_LINK_PORT } from '../../core/ports';
import { ReactionState } from '../../core/domain';

describe('message links', () => {
  it('protects only the active overlay surface from document pointerdown', () => {
    const host = document.createElement('app-message-item');
    host.dataset['messageId'] = 'wire-1';
    const message = document.createElement('article');
    const panel = document.createElement('div');
    panel.dataset['overlayPanel'] = 'menu';
    const body = document.createElement('p');
    message.append(panel, body);
    host.append(message);
    document.body.append(host);

    const insideEvent = { composedPath: () => [panel, message, host] } as unknown as PointerEvent;
    const bodyEvent = { composedPath: () => [body, message, host] } as unknown as PointerEvent;

    expect(isProtectedMessageOverlayPointer(insideEvent, 'wire-1')).toBe(true);
    expect(isProtectedMessageOverlayPointer(bodyEvent, 'wire-1')).toBe(false);
    host.remove();
  });

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
    const open = vi.fn(async () => ({
      ok: true as const,
      version: 1 as const,
      requestId: 'link',
      value: undefined,
    }));
    await TestBed.configureTestingModule({
      imports: [MessageItemComponent],
      providers: [{ provide: EXTERNAL_LINK_PORT, useValue: { open } }],
    }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> =
      TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'contact@example.test');
    fixture.componentRef.setInput('body', 'https://example.test/notice');
    fixture.componentRef.setInput('outgoing', false);
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.message-link') as HTMLAnchorElement).click();
    expect(confirmation).toHaveBeenCalledWith(
      expect.stringContaining('https://example.test/notice'),
    );
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://example.test/notice' }),
    );
    confirmation.mockRestore();
  });

  it('applies the large-emoji classes only for one to three emoji-only messages', async () => {
    await TestBed.configureTestingModule({ imports: [MessageItemComponent] }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> =
      TestBed.createComponent(MessageItemComponent);
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
    const fixture: ComponentFixture<MessageItemComponent> =
      TestBed.createComponent(MessageItemComponent);
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

    (fixture.nativeElement.querySelector('.message-action--menu') as HTMLButtonElement).click();
    expect(overlays.at(-1)).toBe('menu');
    fixture.componentRef.setInput('activeOverlay', 'menu');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
    fixture.nativeElement
      .querySelector('article')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(overlays.at(-1)).toBeUndefined();
  });

  it('opens the action menu below a message near the scroll viewport top', async () => {
    await TestBed.configureTestingModule({ imports: [MessageItemComponent] }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> =
      TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'contact@example.test');
    fixture.componentRef.setInput('body', 'Mensaje reciente');
    fixture.componentRef.setInput('outgoing', false);
    fixture.componentRef.setInput('messageId', 'wire-top');
    fixture.detectChanges();

    const viewport = document.createElement('div');
    viewport.className = 'chat-content';
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 100, bottom: 500 }),
    });
    const article = fixture.nativeElement.querySelector('article') as HTMLElement;
    Object.defineProperty(article, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 116, bottom: 180 }),
    });
    viewport.append(fixture.nativeElement);
    document.body.append(viewport);

    (fixture.nativeElement.querySelector('.message-action--menu') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(article.classList.contains('overlay-below')).toBe(true);
    viewport.remove();
  });

  it('keeps a persisted quote visible when its original is outside the loaded timeline', async () => {
    await TestBed.configureTestingModule({ imports: [MessageItemComponent] }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> =
      TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'Tú');
    fixture.componentRef.setInput('body', 'Respuesta histórica');
    fixture.componentRef.setInput('outgoing', true);
    fixture.componentRef.setInput('replyTo', {
      authorJid: 'barbara@example.test',
      messageId: 'wire-not-loaded',
      stanzaIds: [],
      quote: 'Mensaje original fuera de la ventana',
    });
    fixture.componentRef.setInput('replyAuthor', 'Barbara');
    fixture.componentRef.setInput('replyText', 'Mensaje original fuera de la ventana');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Mensaje original fuera de la ventana');
    expect(fixture.nativeElement.querySelector('.message-reply-link--unavailable')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.message-reply-link small')).toBeNull();
  });

  it('renders a Gajim-style quote and toggles reaction chips with participant tooltip', async () => {
    await TestBed.configureTestingModule({ imports: [MessageItemComponent] }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> =
      TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'Tú');
    fixture.componentRef.setInput('body', 'Respuesta nueva');
    fixture.componentRef.setInput('outgoing', true);
    fixture.componentRef.setInput('messageId', 'wire-reply');
    fixture.componentRef.setInput('replyTo', {
      authorJid: 'barbara@example.test',
      quote: 'Desde Gajim',
    });
    fixture.componentRef.setInput('replyAuthor', 'barbara');
    fixture.componentRef.setInput('replyTime', '18:35');
    fixture.componentRef.setInput('replyText', 'Desde Gajim');
    fixture.componentRef.setInput('replyTargetId', 'wire-original');
    const reactions: ReadonlyArray<string>[] = [];
    fixture.componentInstance.reactionChanged.subscribe((value) => reactions.push(value));
    const state: ReactionState = {
      accountId: 'me@example.test',
      conversationId: 'barbara@example.test',
      targetMessageId: 'wire-reply',
      target: { messageId: 'wire-reply', stanzaIds: [], authorJid: 'me@example.test' },
      reactions: [
        {
          emoji: '😍',
          actors: [{ id: 'barbara@example.test', label: 'barbara', identifiable: true }],
        },
      ],
      updatedAt: '2026-11-07T18:35:00.000Z',
      source: 'direct',
    };
    fixture.componentRef.setInput('reactions', state);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Respuesta a');
    expect(fixture.nativeElement.querySelector('.message-reply-icon')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('barbara');
    expect(fixture.nativeElement.textContent).toContain('18:35');
    expect(fixture.nativeElement.querySelectorAll('details')).toHaveLength(0);

    const chip = fixture.nativeElement.querySelector(
      'button.message-reaction',
    ) as HTMLButtonElement;
    chip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    fixture.detectChanges();
    const tooltip = fixture.nativeElement.querySelector('.message-reaction-tooltip') as HTMLElement;
    expect(tooltip.textContent?.trim()).toBe('😍 barbara');
    expect(tooltip.getAttribute('aria-label')).toBe('😍 barbara');
    expect(chip.getAttribute('aria-label')).toContain('😍 barbara');
    chip.click();
    expect(reactions.at(-1)).toEqual(['😍']);

    fixture.componentRef.setInput('ownReactionEmojis', ['😍']);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button.message-reaction') as HTMLButtonElement).click();
    expect(reactions.at(-1)).toEqual([]);
  });

  it('summarizes several reaction participants in one compact accessible line', async () => {
    await TestBed.configureTestingModule({ imports: [MessageItemComponent] }).compileComponents();
    const fixture: ComponentFixture<MessageItemComponent> =
      TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('sender', 'contact@example.test');
    fixture.componentRef.setInput('body', 'Hola');
    fixture.componentRef.setInput('outgoing', false);
    fixture.componentRef.setInput('messageId', 'wire-many-reactions');
    fixture.componentRef.setInput('reactions', {
      accountId: 'me@example.test',
      conversationId: 'contact@example.test',
      targetMessageId: 'wire-many-reactions',
      target: {
        messageId: 'wire-many-reactions',
        stanzaIds: [],
        authorJid: 'contact@example.test',
      },
      reactions: [
        {
          emoji: '😍',
          actors: [
            { id: 'barbara@example.test', label: 'barbara', identifiable: true },
            { id: 'steeven@example.test', label: 'steeven', identifiable: true },
            { id: 'carla@example.test', label: 'carla', identifiable: true },
            { id: 'david@example.test', label: 'david', identifiable: true },
          ],
        },
      ],
      updatedAt: '2026-11-07T18:35:00.000Z',
      source: 'direct',
    } satisfies ReactionState);
    fixture.detectChanges();

    const chip = fixture.nativeElement.querySelector(
      'button.message-reaction',
    ) as HTMLButtonElement;
    chip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    fixture.detectChanges();
    expect(
      (
        fixture.nativeElement.querySelector('.message-reaction-tooltip') as HTMLElement
      ).textContent?.trim(),
    ).toBe('😍 barbara, steeven y 2 más');
  });
});
