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
import { ConnectionSettingsDialogComponent } from './connection-settings-dialog.component';
import { ConversationTimelineItem, ConversationViewComponent } from './conversation-view.component';
import { FileTransferCardComponent } from './file-transfer-card.component';
import { LoginPanelComponent } from './login-panel.component';
import { MessageComposerComponent } from './message-composer.component';
import { MucViewComponent } from './muc-view.component';
import { OperatorPresenceComponent } from './operator-presence.component';
import { SidebarComponent } from './sidebar.component';
import { PresenceOption } from './sidebar.models';

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
    const submitButton = fixture.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
    fixture.componentRef.setInput('accountId', 'operator@@invalid');
    fixture.detectChanges();
    expect(submitButton.disabled).toBe(true);
    fixture.componentRef.setInput('accountId', 'operator');
    fixture.componentRef.setInput('domain', '');
    fixture.detectChanges();
    expect(submitButton.disabled).toBe(true);
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('integrates the account selector and supports keyboard selection', async () => {
    await TestBed.configureTestingModule({ imports: [LoginPanelComponent] }).compileComponents();
    const fixture = TestBed.createComponent(LoginPanelComponent);
    fixture.componentRef.setInput('accountId', 'operator@example.invalid');
    fixture.componentRef.setInput('password', 'secret');
    fixture.componentRef.setInput('profiles', [
      {
        accountId: 'operator@example.invalid',
        domain: 'example.invalid',
        mode: 'automatic',
        updatedAt: '2026-01-01',
        hasPersistentCredential: true,
      },
      {
        accountId: 'juan',
        domain: '',
        mode: 'manual',
        manualEndpoint: { host: 'chat.example.invalid', port: 5222, transport: 'starttls' },
        updatedAt: '2026-01-02',
        hasPersistentCredential: false,
      },
    ]);
    fixture.componentRef.setInput('password', '');
    const selected = vi.fn();
    fixture.componentInstance.profileSelected.subscribe(selected);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select[name="profile"]')).toBeNull();
    expect(
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    fixture.componentRef.setInput('remember', true);
    fixture.componentRef.setInput('selectedProfileId', 'operator@example.invalid');
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
    ).toBe(false);
    fixture.componentRef.setInput('remember', false);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement).disabled,
    ).toBe(true);
    const trigger = fixture.nativeElement.querySelector('.profile-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeTruthy();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await Promise.resolve();
    const options = fixture.nativeElement.querySelectorAll(
      '[role="option"]',
    ) as NodeListOf<HTMLButtonElement>;
    options[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(selected).toHaveBeenCalledWith('juan');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();
  });

  it('opens advanced settings as a modal and keeps cancellation isolated', async () => {
    await TestBed.configureTestingModule({
      imports: [ConnectionSettingsDialogComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ConnectionSettingsDialogComponent);
    fixture.componentRef.setInput('initial', {
      automatic: false,
      host: 'chat.example.invalid',
      port: 5222,
      transport: 'starttls',
    });
    const saved = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.saved.subscribe(saved);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
    const automatic = fixture.nativeElement.querySelector(
      'input[name="automatic"]',
    ) as HTMLInputElement;
    automatic.click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('input[name="host"]') as HTMLInputElement).disabled,
    ).toBe(false);
    const restore = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Restaurar'),
    ) as HTMLButtonElement;
    restore.click();
    fixture.detectChanges();
    expect(restore.textContent).toContain('Confirmar restauración');
    restore.click();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement.querySelector('input[name="automatic"]') as HTMLInputElement).checked,
    ).toBe(true);
    (fixture.nativeElement.querySelector('button[type="button"]') as HTMLButtonElement).click();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(saved).not.toHaveBeenCalled();
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
    fixture.componentRef.setInput('model', {
      operator: {
        accountId: 'operator@example.invalid',
        connectionLabel: 'Conectado',
        presenceLabel: 'En línea',
        presenceDot: 'online',
        presenceOpen: false,
        presenceOptions: options,
        presenceOptionId: 'online',
        presenceStatus: '',
        settingsOpen: false,
        preferences: { theme: 'atomic', notifications: true, autoLogin: false },
      },
      muc: {
        nickname: '',
        discovering: false,
        error: null,
        services: [room],
        states: [],
        selectedRoomJid: '',
        activeRoomState: undefined,
      },
      conversations: {
        search: '',
        directoryOpen: true,
        joinedRooms: [],
        filteredContacts: contacts,
        muc: {
          nickname: '',
          discovering: false,
          error: null,
          services: [room],
          states: [],
          selectedRoomJid: '',
          activeRoomState: undefined,
        },
        selectedJid: '',
        selectedRoomJid: '',
      },
    });
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
    const closed = vi.fn();
    const dropped = vi.fn();
    const rejected = vi.fn();
    fixture.componentInstance.closeRequested.subscribe(closed);
    fixture.componentInstance.filesDropped.subscribe(dropped);
    fixture.componentInstance.dropRejected.subscribe(rejected);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.message-sender')?.textContent).toContain(
      'Contacto',
    );
    expect(fixture.nativeElement.querySelector('input[name="message"]')).toBeTruthy();
    (fixture.nativeElement.querySelector('.conversation-close') as HTMLButtonElement).click();
    expect(closed).toHaveBeenCalledOnce();
    const dataTransfer = {
      types: ['Files'],
      items: [],
      files: [new File(['fixture'], 'fixture.txt')],
      dropEffect: 'none',
    };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    fixture.nativeElement.querySelector('.conversation-surface').dispatchEvent(drop);
    expect(dropped).toHaveBeenCalledWith(dataTransfer.files);
    const textDrop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(textDrop, 'dataTransfer', {
      value: { types: ['text/plain'], items: [], files: [], dropEffect: 'none' },
    });
    fixture.nativeElement.querySelector('.conversation-surface').dispatchEvent(textDrop);
    expect(textDrop.defaultPrevented).toBe(false);
    const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, 'dataTransfer', { value: dataTransfer });
    fixture.nativeElement.querySelector('.conversation-surface').dispatchEvent(dragEnter);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Suelta aquí tus archivos');
    const directoryTransfer = {
      types: ['Files'],
      items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }],
      files: dataTransfer.files,
      dropEffect: 'none',
    };
    const directoryDrop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(directoryDrop, 'dataTransfer', { value: directoryTransfer });
    fixture.nativeElement.querySelector('.conversation-surface').dispatchEvent(directoryDrop);
    expect(rejected).toHaveBeenCalledWith('No se pueden enviar carpetas.');
    expect(dropped).toHaveBeenCalledOnce();
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
    const close = vi.fn();
    fixture.componentInstance.leave.subscribe(leave);
    fixture.componentInstance.closeRequested.subscribe(close);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('mensaje');
    (fixture.nativeElement.querySelector('.muc-room-meta button') as HTMLButtonElement).click();
    expect(leave).toHaveBeenCalledOnce();
    (fixture.nativeElement.querySelector('.conversation-close') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps transfer actions limited to the offered state', async () => {
    await TestBed.configureTestingModule({
      imports: [FileTransferCardComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(FileTransferCardComponent);
    const transfer = {
      offer: {
        transferId: 'file-1',
        accountId: 'operator@example.invalid',
        conversationId: 'contact@example.invalid',
        senderJid: 'contact@example.invalid',
        name: 'demo.txt',
        sizeBytes: '4',
        transport: 'ibb' as const,
        offeredAt: new Date().toISOString(),
      },
      direction: 'incoming' as const,
      state: 'offered' as const,
      bytesTransferred: '0',
      updatedAt: new Date().toISOString(),
    };
    fixture.componentRef.setInput('transfer', transfer);
    fixture.componentRef.setInput('label', 'Archivo ofrecido');
    const accepted = vi.fn();
    const rejected = vi.fn();
    const cancelled = vi.fn();
    fixture.componentInstance.accepted.subscribe(accepted);
    fixture.componentInstance.rejected.subscribe(rejected);
    fixture.componentInstance.cancelled.subscribe(cancelled);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.file-actions button')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('button:not(.file-actions button)')).toBeNull();
    (fixture.nativeElement.querySelector('.file-actions button') as HTMLButtonElement).click();
    (
      fixture.nativeElement.querySelectorAll('.file-actions button')[1] as HTMLButtonElement
    ).click();
    expect(accepted).toHaveBeenCalledWith('file-1');
    expect(rejected).toHaveBeenCalledWith('file-1');
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('shows local open actions only for completed transfers with a safe reference', async () => {
    await TestBed.configureTestingModule({
      imports: [FileTransferCardComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(FileTransferCardComponent);
    const completedTransfer = {
      offer: {
        transferId: 'file-completed',
        accountId: 'operator@example.invalid',
        conversationId: 'contact@example.invalid',
        senderJid: 'contact@example.invalid',
        name: 'report.pdf',
        sizeBytes: '4',
        transport: 'ibb' as const,
        offeredAt: new Date().toISOString(),
      },
      direction: 'incoming' as const,
      state: 'completed' as const,
      bytesTransferred: '4',
      localActions: { open: true, reveal: true },
      updatedAt: new Date().toISOString(),
    };
    fixture.componentRef.setInput('transfer', completedTransfer);
    fixture.componentRef.setInput('label', 'Archivo recibido correctamente');
    const opened = vi.fn();
    const revealed = vi.fn();
    fixture.componentInstance.opened.subscribe(opened);
    fixture.componentInstance.revealed.subscribe(revealed);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll('.file-actions button');
    expect(buttons).toHaveLength(2);
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    expect(opened).toHaveBeenCalledWith('file-completed');
    expect(revealed).toHaveBeenCalledWith('file-completed');
    fixture.componentRef.setInput('transfer', {
      ...completedTransfer,
      direction: 'outgoing',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.file-actions button')).toHaveLength(0);
  });

  it('reuses the composer for attachable direct chat and text-only MUC input', async () => {
    await TestBed.configureTestingModule({
      imports: [MessageComposerComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(MessageComposerComponent);
    fixture.componentRef.setInput('inputName', 'message');
    fixture.componentRef.setInput('placeholder', 'Escribir');
    fixture.componentRef.setInput('draft', 'texto');
    fixture.componentRef.setInput('disabled', false);
    fixture.componentRef.setInput('showAttach', true);
    fixture.componentRef.setInput('showEmoji', true);
    const submitted = vi.fn();
    const attached = vi.fn();
    fixture.componentInstance.messageSubmitted.subscribe(submitted);
    fixture.componentInstance.attach.subscribe(attached);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="message"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.composer-icon')).toBeTruthy();
    (fixture.nativeElement.querySelector('.composer-icon') as HTMLButtonElement).click();
    (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
      new Event('submit'),
    );
    expect(attached).toHaveBeenCalledOnce();
    expect(submitted).toHaveBeenCalledOnce();
    fixture.componentRef.setInput('inputName', 'muc-message');
    fixture.componentRef.setInput('showAttach', false);
    fixture.componentRef.setInput('showEmoji', false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="muc-message"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.composer-icon')).toBeNull();
  });

  it('provides a keyboard-complete presence menu with a radio pattern', async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorPresenceComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OperatorPresenceComponent);
    const options: ReadonlyArray<PresenceOption> = [
      { id: 'online', mode: undefined, label: 'En línea', dot: 'online' },
      { id: 'away', mode: 'away', label: 'Ausente', dot: 'away' },
    ];
    const presenceModel = {
      accountId: 'operator@example.invalid',
      connectionLabel: 'Conectado',
      presenceLabel: 'En línea',
      presenceDot: 'online',
      presenceOpen: true,
      presenceOptions: options,
      presenceOptionId: 'online',
      presenceStatus: '',
      settingsOpen: false,
      preferences: { theme: 'atomic', notifications: true, autoLogin: false },
    };
    fixture.componentRef.setInput('model', presenceModel);
    const selected = vi.fn();
    const statusChanged = vi.fn();
    fixture.componentInstance.presenceSelected.subscribe(selected);
    fixture.componentInstance.presenceStatusChange.subscribe(statusChanged);
    fixture.componentInstance.presenceClose.subscribe(() => {
      fixture.componentRef.setInput('model', { ...presenceModel, presenceOpen: false });
    });
    fixture.detectChanges();
    const menu = fixture.nativeElement.querySelector('[role="menu"]') as HTMLElement;
    const buttons = menu.querySelectorAll(
      '[role="menuitemradio"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(menu).toBeTruthy();
    expect(buttons).toHaveLength(options.length);
    expect(menu.querySelector('input')).toBeNull();
    expect(buttons[0].getAttribute('aria-checked')).toBe('true');
    expect(buttons[0].tabIndex).toBe(0);
    expect(buttons[1].tabIndex).toBe(-1);
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    buttons[0].dispatchEvent(tabEvent);
    expect(tabEvent.defaultPrevented).toBe(false);
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(selected).toHaveBeenCalledTimes(1);
    expect(selected).toHaveBeenLastCalledWith(options[1]);
    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(selected).toHaveBeenCalledTimes(2);
    buttons[1].click();
    expect(selected).toHaveBeenCalledTimes(3);

    const statusInput = fixture.nativeElement.querySelector(
      'input[aria-label="Mensaje de estado"]',
    ) as HTMLInputElement;
    statusInput.value = 'En reunión';
    statusInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(statusChanged).toHaveBeenCalledWith('En reunión');

    buttons[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.presence-trigger'));

    fixture.componentRef.setInput('model', { ...presenceModel, presenceOpen: true });
    fixture.detectChanges();
    const reopenedInput = fixture.nativeElement.querySelector(
      'input[aria-label="Mensaje de estado"]',
    ) as HTMLInputElement;
    reopenedInput.focus();
    reopenedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.nativeElement.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.presence-trigger'));
  });

  it('renders the certificate decisions and emits the selected policy', async () => {
    await TestBed.configureTestingModule({
      imports: [CertificateDialogComponent],
    }).compileComponents();
    const previousFocus = document.createElement('button');
    document.body.append(previousFocus);
    previousFocus.focus();
    const fixture = TestBed.createComponent(CertificateDialogComponent);
    fixture.componentRef.setInput('request', certificateRequest);
    const decision = vi.fn();
    fixture.componentInstance.decision.subscribe(decision);
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.nativeElement.querySelectorAll('.certificate-actions button')).toHaveLength(3);
    (
      fixture.nativeElement.querySelector(
        '.certificate-actions button.primary',
      ) as HTMLButtonElement
    ).click();
    expect(decision).toHaveBeenCalledWith('trust_and_remember');
    fixture.destroy();
    await Promise.resolve();
    expect(document.activeElement).toBe(previousFocus);
    previousFocus.remove();
  });

  it('renders the three Wasteland theme choices in preferences', async () => {
    await TestBed.configureTestingModule({
      imports: [OperatorPresenceComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(OperatorPresenceComponent);
    fixture.componentRef.setInput('model', {
      accountId: 'operator@example.invalid',
      connectionLabel: 'Conectado',
      presenceLabel: 'En línea',
      presenceDot: 'online',
      presenceOpen: false,
      presenceOptions: [],
      presenceOptionId: 'online',
      presenceStatus: '',
      settingsOpen: true,
      preferences: { theme: 'atomic', notifications: true, autoLogin: false },
    });
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector(
      'select[aria-label="Tema"]',
    ) as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(Array.from(select.options).map((option) => option.textContent)).toEqual([
      'Wasteland Terminal',
      'Wasteland Terminal Claro',
      'Personalizado',
    ]);
  });
});
