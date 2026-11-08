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
});
