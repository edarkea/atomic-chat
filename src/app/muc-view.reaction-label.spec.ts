import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ReactionActor, RoomRef, RoomState } from './core/domain';
import { MucViewComponent } from './muc-view.component';

describe('MucViewComponent reaction actor labels', () => {
  it('keeps the nickname callback bound to room context and hides unavailable identities', async () => {
    await TestBed.configureTestingModule({ imports: [MucViewComponent] }).compileComponents();
    const room: RoomRef = {
      service: 'conference.example.invalid',
      room: 'lobby',
      jid: 'lobby@conference.example.invalid',
    };
    const state: RoomState = {
      accountId: 'operator@example.invalid',
      room,
      status: 'joined',
      selfOccupantJid: `${room.jid}/operator`,
      participants: [],
      sessionGeneration: 1,
    };
    const fixture = TestBed.createComponent(MucViewComponent);
    fixture.componentRef.setInput('roomState', state);
    fixture.componentRef.setInput('notices', []);
    fixture.componentRef.setInput('participants', []);
    fixture.componentRef.setInput('allParticipantCount', 0);
    fixture.componentRef.setInput('participantPage', 0);
    fixture.componentRef.setInput('hasMoreParticipants', false);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();

    const label = (fixture.componentInstance as unknown as { reactionActorLabel: (actor: ReactionActor) => string }).reactionActorLabel;
    expect(label({ id: `${room.jid}/barbara`, label: 'ignored', identifiable: false, occupantJid: `${room.jid}/barbara` })).toBe('barbara');
    expect(label({ id: state.accountId, label: 'ignored', identifiable: true })).toBe('Tú');
    expect(label({ id: 'anonymous', label: 'real identity', identifiable: false })).toBe('Participante');
  });

  it('clears the active overlay when the room session changes', async () => {
    await TestBed.configureTestingModule({ imports: [MucViewComponent] }).compileComponents();
    const room: RoomRef = {
      service: 'conference.example.invalid',
      room: 'lobby',
      jid: 'lobby@conference.example.invalid',
    };
    const state: RoomState = {
      accountId: 'operator@example.invalid',
      room,
      status: 'joined',
      selfOccupantJid: `${room.jid}/operator`,
      participants: [],
      sessionGeneration: 1,
    };
    const fixture = TestBed.createComponent(MucViewComponent);
    fixture.componentRef.setInput('roomState', state);
    fixture.componentRef.setInput('notices', []);
    fixture.componentRef.setInput('participants', []);
    fixture.componentRef.setInput('allParticipantCount', 0);
    fixture.componentRef.setInput('participantPage', 0);
    fixture.componentRef.setInput('hasMoreParticipants', false);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();

    const component = fixture.componentInstance as unknown as {
      setOverlay: (messageId: string, overlay: 'quick' | 'menu' | 'picker' | undefined) => void;
      overlayFor: (messageId: string) => 'quick' | 'menu' | 'picker' | undefined;
    };
    component.setOverlay('room-message', 'picker');
    expect(component.overlayFor('room-message')).toBe('picker');
    fixture.componentRef.setInput('roomState', { ...state, sessionGeneration: 2 });
    fixture.detectChanges();
    expect(component.overlayFor('room-message')).toBeUndefined();
  });

  it('shows the latest-message button while reading above the room end', async () => {
    await TestBed.configureTestingModule({ imports: [MucViewComponent] }).compileComponents();
    const room: RoomRef = {
      service: 'conference.example.invalid',
      room: 'lobby',
      jid: 'lobby@conference.example.invalid',
    };
    const state: RoomState = {
      accountId: 'operator@example.invalid',
      room,
      status: 'joined',
      selfOccupantJid: `${room.jid}/operator`,
      participants: [],
      sessionGeneration: 1,
    };
    const fixture = TestBed.createComponent(MucViewComponent);
    fixture.componentRef.setInput('roomState', state);
    fixture.componentRef.setInput('notices', []);
    fixture.componentRef.setInput('participants', []);
    fixture.componentRef.setInput('allParticipantCount', 0);
    fixture.componentRef.setInput('participantPage', 0);
    fixture.componentRef.setInput('hasMoreParticipants', false);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();

    const area = fixture.nativeElement.querySelector('.muc-messages') as HTMLElement;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
    });
    area.scrollTop = 0;
    (fixture.componentInstance as unknown as { onMessagesScroll: () => void }).onMessagesScroll();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[aria-label="Ir al último mensaje"]')).toBeTruthy();
  });
});
