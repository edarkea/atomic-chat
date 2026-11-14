import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ConversationTimelineItem, ConversationViewComponent } from './conversation-view.component';
import { Message, ReactionActor } from '../../core/domain';

describe('ConversationViewComponent profile search target', () => {
  it('keeps the typing indicator in a reserved slot and names the contact', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'steeven@example.invalid');
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.componentRef.setInput('initialTimelineReady', true);
    fixture.componentRef.setInput('typing', 'Steeven');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.typing-indicator')?.textContent).toContain(
      'Steeven está escribiendo',
    );
    expect(fixture.nativeElement.querySelector('.typing-indicator-slot')).toBeTruthy();

    fixture.componentRef.setInput('typing', '');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.typing-indicator-slot')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.typing-indicator')).toBeNull();
  });

  it('keeps the profile card static and exposes search and games as header actions', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'contact@example.invalid');
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.componentRef.setInput('initialTimelineReady', true);
    fixture.detectChanges();

    const profile = fixture.nativeElement.querySelector('.conversation-profile') as HTMLElement;
    expect(profile.tagName).toBe('DIV');
    expect(fixture.nativeElement.querySelector('.conversation-close')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Buscar en conversación"]'),
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[aria-label="Juegos"]')).toBeTruthy();

    (
      fixture.nativeElement.querySelector(
        '[aria-label="Buscar en conversación"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-message-search')).toBeTruthy();
  });

  it('keeps direct reaction actor labels bound to the conversation context', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'barbara@localhost');
    fixture.componentRef.setInput('accountId', 'steeven@localhost');
    fixture.componentRef.setInput('activeContact', {
      jid: 'barbara@localhost',
      name: 'Barbara',
      groups: [],
    });
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.componentRef.setInput('initialTimelineReady', true);
    fixture.detectChanges();

    const label = (
      fixture.componentInstance as unknown as {
        reactionActorLabel: (actor: ReactionActor) => string;
      }
    ).reactionActorLabel;
    const contact: ReactionActor = {
      id: 'barbara@localhost',
      label: 'ignored',
      identifiable: true,
    };
    const own: ReactionActor = {
      id: 'steeven@localhost/resource',
      label: 'ignored',
      identifiable: true,
    };
    expect(label(contact)).toBe('Barbara');
    expect(label(own)).toBe('Tú');

    fixture.componentRef.setInput('activeContact', undefined);
    fixture.detectChanges();
    expect(label(contact)).toBe('barbara');
  });

  it('clears the active overlay when the selected conversation changes', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'barbara@localhost');
    fixture.componentRef.setInput('accountId', 'steeven@localhost');
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.componentRef.setInput('initialTimelineReady', true);
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      setOverlay: (messageId: string, overlay: 'quick' | 'menu' | 'picker' | undefined) => void;
      overlayFor: (messageId: string) => 'quick' | 'menu' | 'picker' | undefined;
    };
    component.setOverlay('wire-1', 'menu');
    expect(component.overlayFor('wire-1')).toBe('menu');
    fixture.componentRef.setInput('selectedJid', 'carla@localhost');
    fixture.detectChanges();
    expect(component.overlayFor('wire-1')).toBeUndefined();
  });

  it('shows the latest-message button away from the end and returns smoothly to the bottom', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'barbara@localhost');
    fixture.componentRef.setInput('accountId', 'steeven@localhost');
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.componentRef.setInput('initialTimelineReady', true);
    fixture.detectChanges();

    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    let height = 1000;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 300 },
    });
    Object.defineProperty(area, 'scrollTo', {
      configurable: true,
      value: ({ top }: { readonly top: number }) => {
        area.scrollTop = top;
      },
    });
    area.scrollTop = 0;
    fixture.componentInstance.onChatScroll();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Ir al último mensaje"]'),
    ).toBeTruthy();

    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Ir al último mensaje"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(area.scrollTop).toBe(700);
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Ir al último mensaje"]'),
    ).toBeNull();
    height = 1100;
  });

  it('indexes direct message IDs once per timeline and preserves persisted reaction and reply semantics', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    const makeText = (
      id: string,
      label: string,
      emoji?: string,
    ): Extract<ConversationTimelineItem, { kind: 'text' }> => {
      const message: Message = {
        id,
        clientMessageId: `client-${id}-${label}`,
        accountId: 'operator@example.invalid',
        conversationId: 'contact@example.invalid',
        senderJid: 'contact@example.invalid',
        body: { kind: 'text', text: label },
        status: 'sent',
        createdAt: '2026-11-10T12:00:00.000Z',
        messageId: `wire-${id}`,
        ...(emoji
          ? {
              reactions: [
                {
                  emoji,
                  actors: [{ id: 'operator@example.invalid', label: 'Tú', identifiable: true }],
                },
              ],
            }
          : {}),
      };
      return {
        kind: 'text',
        id: `text:${id}:${label}`,
        sortAt: message.createdAt,
        message,
        senderLabel: label,
        outgoing: false,
      };
    };
    const first = makeText('one', 'Primera versión', '👍');
    const second = makeText('two', 'Segunda versión');
    const timeline: ReadonlyArray<ConversationTimelineItem> = [first, second];
    fixture.componentRef.setInput('selectedJid', 'contact@example.invalid');
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('timeline', timeline);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.componentRef.setInput('initialTimelineReady', true);
    fixture.detectChanges();

    const view = fixture.componentInstance as unknown as {
      reactionFor: (id: string) => import('../../core/domain').ReactionState | undefined;
      ownReactionEmojis: (id: string) => ReadonlyArray<string>;
      replyTargetId: (reference: Message['replyTo']) => string;
      replyAuthor: (reference: Message['replyTo']) => string;
      replyQuote: (reference: Message['replyTo']) => string;
      replyTime: (reference: Message['replyTo']) => string;
    };
    const find = vi.spyOn(timeline, 'find');
    expect(view.reactionFor('one')?.reactions[0]?.emoji).toBe('👍');
    expect(view.ownReactionEmojis('one')).toEqual(['👍']);
    expect(view.reactionFor('two')).toBeUndefined();
    expect(view.reactionFor('absent')).toBeUndefined();
    expect(find).not.toHaveBeenCalled();

    const ref: NonNullable<Message['replyTo']> = {
      authorJid: 'contact@example.invalid',
      messageId: 'wire-one',
      stanzaIds: [],
      quote: 'Cita temporal',
    };
    expect(view.replyTargetId(ref)).toBe('one');
    expect(view.replyAuthor(ref)).toBe('Primera versión');
    expect(view.replyQuote(ref)).toBe('Primera versión');
    expect(view.replyTime(ref)).not.toBe('');

    // A duplicate must select the first text message, matching Array.find.
    // Avoid rendering duplicate @for keys: direct input reads are synchronous.
    fixture.componentRef.setInput('timeline', [
      makeText('one', 'Duplicado primero', '😎'),
      makeText('one', 'Duplicado después', '❤️'),
    ]);
    expect(view.reactionFor('one')?.reactions[0]?.emoji).toBe('😎');
    expect(view.ownReactionEmojis('one')).toEqual(['😎']);

    fixture.componentRef.setInput('timeline', [makeText('one', 'Reemplazo', '🎉')]);
    expect(view.reactionFor('one')?.reactions[0]?.emoji).toBe('🎉');
    expect(view.replyAuthor(ref)).toBe('Reemplazo');
    find.mockRestore();
  });
});
