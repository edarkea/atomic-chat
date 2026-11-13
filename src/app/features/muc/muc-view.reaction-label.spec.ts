import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ReactionActor, RoomRef, RoomState } from '../../core/domain';
import { MucViewComponent } from './muc-view.component';

describe('MucViewComponent reaction actor labels', () => {
  it('omits identity and public-logging advisories but retains an actual nickname change notice', async () => {
    await TestBed.configureTestingModule({ imports: [MucViewComponent] }).compileComponents();
    const room: RoomRef = {
      service: 'conference.example.invalid',
      room: 'lobby',
      jid: 'lobby@conference.example.invalid',
    };
    const accountId = 'operator@example.invalid';
    const state: RoomState = {
      accountId,
      room,
      status: 'joined',
      selfOccupantJid: `${room.jid}/operator`,
      participants: [],
      sessionGeneration: 1,
    };
    const fixture = TestBed.createComponent(MucViewComponent);
    fixture.componentRef.setInput('roomState', state);
    fixture.componentRef.setInput('notices', [
      { accountId, roomJid: room.jid, code: 'IDENTITY_VISIBLE', sessionGeneration: 1 },
      { accountId, roomJid: room.jid, code: 'PUBLIC_LOGGING', sessionGeneration: 1 },
    ]);
    fixture.componentRef.setInput('participants', []);
    fixture.componentRef.setInput('allParticipantCount', 0);
    fixture.componentRef.setInput('participantPage', 0);
    fixture.componentRef.setInput('hasMoreParticipants', false);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-notices')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('La identidad real puede ser visible');
    expect(fixture.nativeElement.textContent).not.toContain('registra conversaciones públicamente');

    fixture.componentRef.setInput('notices', [
      { accountId, roomJid: room.jid, code: 'IDENTITY_VISIBLE', sessionGeneration: 1 },
      { accountId, roomJid: room.jid, code: 'PUBLIC_LOGGING', sessionGeneration: 1 },
      {
        accountId,
        roomJid: room.jid,
        code: 'SERVER_NICKNAME',
        nickname: 'operator-2',
        sessionGeneration: 1,
      },
    ]);
    fixture.detectChanges();
    const notices = fixture.nativeElement.querySelectorAll('.muc-notices p');
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toContain('operator-2');
  });

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

    const label = (
      fixture.componentInstance as unknown as {
        reactionActorLabel: (actor: ReactionActor) => string;
      }
    ).reactionActorLabel;
    expect(
      label({
        id: `${room.jid}/barbara`,
        label: 'ignored',
        identifiable: false,
        occupantJid: `${room.jid}/barbara`,
      }),
    ).toBe('barbara');
    expect(label({ id: state.accountId, label: 'ignored', identifiable: true })).toBe('Tú');
    expect(label({ id: 'anonymous', label: 'real identity', identifiable: false })).toBe(
      'Participante',
    );
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

  it('distinguishes away, extended-away and dnd participants without removing them', async () => {
    await TestBed.configureTestingModule({ imports: [MucViewComponent] }).compileComponents();
    const room: RoomRef = {
      service: 'conference.example.invalid',
      room: 'lobby',
      jid: 'lobby@conference.example.invalid',
    };
    const participants = [
      {
        occupantJid: `${room.jid}/operator`,
        nick: 'operator',
        role: 'participant' as const,
        affiliation: 'member' as const,
        availability: 'away' as const,
      },
      {
        occupantJid: `${room.jid}/lara`,
        nick: 'lara',
        role: 'participant' as const,
        affiliation: 'member' as const,
        availability: 'extended-away' as const,
      },
      {
        occupantJid: `${room.jid}/barbara`,
        nick: 'barbara',
        role: 'participant' as const,
        affiliation: 'member' as const,
        availability: 'dnd' as const,
      },
    ];
    const state: RoomState = {
      accountId: 'operator@example.invalid',
      room,
      status: 'joined',
      selfOccupantJid: participants[0].occupantJid,
      participants,
      sessionGeneration: 1,
    };
    const fixture = TestBed.createComponent(MucViewComponent);
    fixture.componentRef.setInput('roomState', state);
    fixture.componentRef.setInput('notices', []);
    fixture.componentRef.setInput('participants', participants);
    fixture.componentRef.setInput('allParticipantCount', participants.length);
    fixture.componentRef.setInput('participantPage', 0);
    fixture.componentRef.setInput('hasMoreParticipants', false);
    fixture.componentRef.setInput('messages', []);
    fixture.componentRef.setInput('draft', '');
    fixture.detectChanges();

    const entries = Array.from(
      fixture.nativeElement.querySelectorAll('.muc-participants > span'),
    ) as HTMLElement[];
    expect(entries).toHaveLength(3);
    expect(entries[0].querySelector('.presence-dot.away')).toBeTruthy();
    expect(entries[0].getAttribute('title')).toContain('Ausente');
    expect(entries[1].querySelector('.presence-dot.xa')).toBeTruthy();
    expect(entries[1].getAttribute('title')).toContain('Ausencia prolongada');
    expect(entries[2].querySelector('.presence-dot.dnd')).toBeTruthy();
    expect(entries[2].getAttribute('title')).toContain('No molestar');

    const available = participants.map((participant) => ({
      ...participant,
      availability: 'available' as const,
    }));
    fixture.componentRef.setInput('participants', available);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('.muc-participants .presence-dot.away'),
    ).toHaveLength(0);
    expect(entries[0].getAttribute('title')).toContain('En línea');
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
    expect(
      fixture.nativeElement.querySelector('button[aria-label="Ir al último mensaje"]'),
    ).toBeTruthy();
  });
});
