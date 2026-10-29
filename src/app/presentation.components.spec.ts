import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  CertificateTrustRequest,
  Contact,
  Message,
  RoomMessage,
  RoomRef,
  RoomState,
} from './core/domain';
import { CertificateDialogComponent } from './certificate-dialog.component';
import { ConversationTimelineItem, ConversationViewComponent } from './conversation-view.component';
import { LoginPanelComponent } from './login-panel.component';
import { MucViewComponent } from './muc-view.component';
import { PresenceOption, SidebarComponent } from './sidebar.component';

const room: RoomRef = {
  service: 'conference.example.invalid',
  room: 'lobby',
  jid: 'lobby@conference.example.invalid',
};
const roomState: RoomState = {
  accountId: 'operator@example.invalid',
  room,
  status: 'joined',
  selfOccupantJid: `${room.jid}/operator`,
  participants: [],
  sessionGeneration: 1,
};
const certificateRequest: CertificateTrustRequest = {
  requestId: 'cert-1',
  accountId: 'operator@example.invalid',
  host: 'xmpp.example.invalid',
  port: 5222,
  transport: 'starttls',
  certificate: {
    fingerprintSha256: 'AA:BB',
    subject: 'CN=xmpp.example.invalid',
    issuer: 'CN=issuer',
    validFrom: '2026-01-01',
    validTo: '2027-01-01',
    subjectAltNames: ['DNS:xmpp.example.invalid'],
    chain: [
      { fingerprintSha256: 'AA:BB', subject: 'CN=xmpp.example.invalid', issuer: 'CN=issuer' },
    ],
    pem: 'pem',
  },
};

describe('extracted Angular presentation components', () => {
  it('renders login fields and emits changes and submit', async () => {
    await TestBed.configureTestingModule({ imports: [LoginPanelComponent] }).compileComponents();
    const fixture = TestBed.createComponent(LoginPanelComponent);
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('password', 'secret');
    fixture.componentRef.setInput('error', 'error visible');
    const accountChange = vi.fn();
    const passwordChange = vi.fn();
    const submit = vi.fn();
    fixture.componentInstance.accountIdChange.subscribe(accountChange);
    fixture.componentInstance.passwordChange.subscribe(passwordChange);
    fixture.componentInstance.submitted.subscribe(submit);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="account"]')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('error visible');
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('keeps sidebar actions presentational and emits intent', async () => {
    await TestBed.configureTestingModule({ imports: [SidebarComponent] }).compileComponents();
    const fixture = TestBed.createComponent(SidebarComponent);
    const options: ReadonlyArray<PresenceOption> = [
      { id: 'online', mode: undefined, label: 'En línea', dot: 'online' },
    ];
    const contacts: ReadonlyArray<Contact> = [
      { jid: 'contact@example.invalid', name: 'Contacto', groups: [], source: 'roster' },
    ];
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('connectionLabel', 'Conectado');
    fixture.componentRef.setInput('presenceLabel', 'En línea');
    fixture.componentRef.setInput('presenceDot', 'online');
    fixture.componentRef.setInput('presenceOpen', false);
    fixture.componentRef.setInput('presenceOptions', options);
    fixture.componentRef.setInput('presenceStatus', '');
    fixture.componentRef.setInput('settingsOpen', false);
    fixture.componentRef.setInput('preferences', {
      theme: 'atomic',
      notifications: true,
      autoLogin: false,
    });
    fixture.componentRef.setInput('search', '');
    fixture.componentRef.setInput('mucNickname', '');
    fixture.componentRef.setInput('mucDiscovering', false);
    fixture.componentRef.setInput('mucServices', [room]);
    fixture.componentRef.setInput('mucStates', []);
    fixture.componentRef.setInput('selectedRoomJid', '');
    fixture.componentRef.setInput('joinedRooms', []);
    fixture.componentRef.setInput('filteredContacts', contacts);
    fixture.componentRef.setInput('selectedJid', '');
    const selectRoom = vi.fn();
    const selectContact = vi.fn();
    fixture.componentInstance.selectRoom.subscribe(selectRoom);
    fixture.componentInstance.selectContact.subscribe(selectContact);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.room-select') as HTMLButtonElement).click();
    (
      fixture.nativeElement.querySelector(
        '.conversation-item:not(.muc-conversation-item)',
      ) as HTMLButtonElement
    ).click();
    expect(selectRoom).toHaveBeenCalledWith(room.jid);
    expect(selectContact).toHaveBeenCalledWith(contacts[0]);
  });

  it('renders individual conversation items and emits file actions', async () => {
    await TestBed.configureTestingModule({
      imports: [ConversationViewComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConversationViewComponent);
    const message: Message = {
      id: 'm1',
      accountId: 'operator@example.invalid',
      conversationId: 'contact@example.invalid',
      clientMessageId: 'm1',
      senderJid: 'contact@example.invalid',
      body: { kind: 'text', text: 'hola' },
      status: 'sent',
      createdAt: new Date().toISOString(),
    };
    const timeline: ReadonlyArray<ConversationTimelineItem> = [
      {
        kind: 'text',
        id: 'text:m1',
        sortAt: message.createdAt,
        message,
        senderLabel: 'Contacto',
        outgoing: false,
      },
    ];
    fixture.componentRef.setInput('activeContact', {
      jid: 'contact@example.invalid',
      name: 'Contacto',
      groups: [],
      source: 'roster',
    });
    fixture.componentRef.setInput('selectedJid', 'contact@example.invalid');
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('timeline', timeline);
    fixture.componentRef.setInput('error', null);
    fixture.componentRef.setInput('draft', '');
    fixture.componentRef.setInput('historyLoading', false);
    fixture.componentRef.setInput('hasOlderMessages', false);
    fixture.componentRef.setInput('hasNewerMessages', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.message-sender')?.textContent).toContain(
      'Contacto',
    );
    expect(fixture.nativeElement.querySelector('input[name="message"]')).toBeTruthy();
  });

  it('renders a MUC room and emits room actions', async () => {
    await TestBed.configureTestingModule({ imports: [MucViewComponent] }).compileComponents();
    const fixture = TestBed.createComponent(MucViewComponent);
    const message: RoomMessage = {
      id: 'muc-1',
      accountId: roomState.accountId,
      roomJid: room.jid,
      occupantJid: `${room.jid}/operator`,
      body: { kind: 'text', text: 'mensaje' },
      receivedAt: new Date().toISOString(),
      source: 'live',
      sessionGeneration: 1,
    };
    fixture.componentRef.setInput('roomState', roomState);
    fixture.componentRef.setInput('notices', []);
    fixture.componentRef.setInput('participants', []);
    fixture.componentRef.setInput('allParticipantCount', 0);
    fixture.componentRef.setInput('participantPage', 0);
    fixture.componentRef.setInput('hasMoreParticipants', false);
    fixture.componentRef.setInput('messages', [message]);
    fixture.componentRef.setInput('draft', '');
    const leave = vi.fn();
    fixture.componentInstance.leave.subscribe(leave);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('mensaje');
    (fixture.nativeElement.querySelector('.muc-room-meta button') as HTMLButtonElement).click();
    expect(leave).toHaveBeenCalledOnce();
  });

  it('renders the certificate decisions and emits the selected policy', async () => {
    await TestBed.configureTestingModule({
      imports: [CertificateDialogComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(CertificateDialogComponent);
    fixture.componentRef.setInput('request', certificateRequest);
    const decision = vi.fn();
    fixture.componentInstance.decision.subscribe(decision);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.certificate-actions button')).toHaveLength(3);
    (
      fixture.nativeElement.querySelector(
        '.certificate-actions button.primary',
      ) as HTMLButtonElement
    ).click();
    expect(decision).toHaveBeenCalledWith('trust_and_remember');
  });
});
