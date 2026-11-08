import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ConversationViewComponent } from './conversation-view.component';
import { ReactionActor } from './core/domain';

describe('ConversationViewComponent profile search target', () => {
  it('uses the complete selected-user profile as the search target', async () => {
    await TestBed.configureTestingModule({ imports: [ConversationViewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'contact@example.invalid');
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.detectChanges();

    const profile = fixture.nativeElement.querySelector('.conversation-profile') as HTMLButtonElement;
    expect(profile.disabled).toBe(false);
    profile.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('app-message-search')).toBeTruthy();
  });

  it('keeps direct reaction actor labels bound to the conversation context', async () => {
    await TestBed.configureTestingModule({ imports: [ConversationViewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'barbara@localhost');
    fixture.componentRef.setInput('accountId', 'steeven@localhost');
    fixture.componentRef.setInput('activeContact', { jid: 'barbara@localhost', name: 'Barbara', groups: [] });
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.detectChanges();

    const label = (fixture.componentInstance as unknown as { reactionActorLabel: (actor: ReactionActor) => string }).reactionActorLabel;
    const contact: ReactionActor = { id: 'barbara@localhost', label: 'ignored', identifiable: true };
    const own: ReactionActor = { id: 'steeven@localhost/resource', label: 'ignored', identifiable: true };
    expect(label(contact)).toBe('Barbara');
    expect(label(own)).toBe('Tú');

    fixture.componentRef.setInput('activeContact', undefined);
    fixture.detectChanges();
    expect(label(contact)).toBe('barbara');
  });

  it('clears the active overlay when the selected conversation changes', async () => {
    await TestBed.configureTestingModule({ imports: [ConversationViewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    fixture.componentRef.setInput('selectedJid', 'barbara@localhost');
    fixture.componentRef.setInput('accountId', 'steeven@localhost');
    fixture.componentRef.setInput('timeline', []);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
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
});
