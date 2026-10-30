import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { App } from './app';
import { ChatFacade } from './core/chat.facade';
import { CertificateTrustRequest, Message, RoomMessage, RoomRef, RoomState } from './core/domain';
import { MucFacade } from './core/muc.facade';
import { corePortProviders } from './core/port-providers';
import { FILE_TRANSFER_PORT } from './core/ports';
import { UnavailableFileTransferPort } from './core/unavailable.ports';

function fakeFacade() {
  return {
    accountId: signal('a@example.invalid'),
    connection: signal({
      accountId: 'a@example.invalid',
      status: 'connected',
      retryable: false,
      since: new Date().toISOString(),
    }),
    contacts: signal([]),
    messages: signal([]),
    presence: signal({ jid: 'a@example.invalid', availability: 'available' }),
    preferences: signal({
      theme: 'atomic',
      notifications: true,
      autoAcceptFileTransfers: false,
      autoLogin: false,
      hideClosedConversations: false,
      fileTransferTimeoutSeconds: 300 as const,
      downloadDirectory: '',
    }),
    error: signal<string | null>(null),
    profiles: signal([]),
    certificateRequest: signal<CertificateTrustRequest | null>(null),
    decideCertificate: vi.fn(),
    tryAutoLogin: vi.fn(),
    isConnected: signal(true),
    historyLoading: signal(false),
    hasOlderMessages: signal(false),
    hasNewerMessages: signal(false),
    connect: vi.fn(async () => true),
    send: vi.fn(async () => true),
    loadConversation: vi.fn(async () => undefined),
    loadOlderMessages: vi.fn(async () => undefined),
    loadNewerMessages: vi.fn(async () => undefined),
    setAvailability: vi.fn(),
    updatePreferences: vi.fn(),
    resetPreferences: vi.fn(),
    disconnect: vi.fn(),
    refreshRoster: vi.fn(),
    getProfilePreferences: vi.fn(async () => undefined),
    saveProfile: vi.fn(async (profile) => ({
      ok: true as const,
      value: profile,
      version: 1 as const,
      requestId: 'test',
    })),
    forgetSecret: vi.fn(async () => true),
    deleteProfile: vi.fn(async () => true),
  } as unknown as ChatFacade;
}

function fakeMucFacade() {
  const services = signal<ReadonlyArray<RoomRef>>([]);
  const states = signal<ReadonlyArray<RoomState>>([]);
  const selectedRoomJid = signal('');
  const selectedState = signal<RoomState | undefined>(undefined);
  const messages = signal<ReadonlyArray<RoomMessage>>([]);
  const select = vi.fn((roomJid: string) => {
    selectedRoomJid.set(roomJid);
    selectedState.set(states().find((state) => state.room.jid === roomJid));
  });
  const clearSelection = vi.fn(() => {
    selectedRoomJid.set('');
    selectedState.set(undefined);
  });
  return {
    services,
    states,
    selectedRoomJid,
    selectedState,
    participants: signal([]),
    visibleParticipants: signal([]),
    hasMoreParticipants: signal(false),
    participantPage: signal(0),
    messages,
    error: signal<string | null>(null),
    visibleNotices: signal([]),
    discover: vi.fn(async () => undefined),
    setAccount: vi.fn(),
    select,
    clearSelection,
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    send: vi.fn(async () => true),
    previousParticipantPage: vi.fn(),
    nextParticipantPage: vi.fn(),
  } as unknown as MucFacade & { messages: WritableSignal<ReadonlyArray<RoomMessage>> };
}

describe('App composer integration', () => {
  let fixture: ComponentFixture<App>;
  let facade: ReturnType<typeof fakeFacade>;
  let muc: ReturnType<typeof fakeMucFacade>;
  const chatMessage = (text: string, clientMessageId: string) => ({
    id: clientMessageId,
    accountId: 'a@example.invalid',
    conversationId: 'contact@example.invalid',
    clientMessageId,
    senderJid: 'contact@example.invalid',
    body: { kind: 'text' as const, text },
    status: 'sent' as const,
    createdAt: new Date().toISOString(),
  });
  const joinedRoom = (room: RoomRef): RoomState => ({
    accountId: 'a@example.invalid',
    room,
    status: 'joined',
    selfOccupantJid: `${room.jid}/operator`,
    participants: [],
    sessionGeneration: 1,
  });
  const mucMessage = (roomJid: string, text: string): RoomMessage => ({
    id: `message-${roomJid}-${text}`,
    accountId: 'a@example.invalid',
    roomJid,
    occupantJid: `${roomJid}/operator`,
    body: { kind: 'text', text },
    receivedAt: new Date().toISOString(),
    source: 'live',
    sessionGeneration: 1,
  });
  const directMessage = (senderJid: string, text: string, id: string): Message => ({
    id,
    accountId: 'a@example.invalid',
    conversationId: 'contact@example.invalid',
    clientMessageId: id,
    senderJid,
    body: { kind: 'text', text },
    status: 'sent',
    createdAt: new Date().toISOString(),
  });
  beforeEach(async () => {
    facade = fakeFacade();
    muc = fakeMucFacade();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        ...corePortProviders,
        { provide: FILE_TRANSFER_PORT, useClass: UnavailableFileTransferPort },
        { provide: ChatFacade, useValue: facade },
        { provide: MucFacade, useValue: muc },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    (fixture.componentInstance as any).conversationSelection.set({
      kind: 'direct',
      accountId: 'a@example.invalid',
      jid: 'contact@example.invalid',
    });
    fixture.detectChanges();
  });

  it('renders one unique local SVG sprite with declared icon references', () => {
    const root = fixture.nativeElement as HTMLElement;
    const symbols = root.querySelectorAll<SVGSymbolElement>('svg.ac-icon-sprite symbol[id^="ac-"]');
    const ids = new Set(Array.from(symbols, (symbol) => symbol.id));

    expect(symbols).toHaveLength(23);
    expect(ids.size).toBe(symbols.length);

    const uses = root.querySelectorAll<SVGUseElement>('svg.ac-icon use');
    for (const use of uses) {
      const href = use.getAttribute('href');
      expect(href?.startsWith('#ac-')).toBe(true);
      expect(ids.has(href?.slice(1) ?? '')).toBe(true);
    }

    const renderedIcons = root.querySelectorAll<SVGSVGElement>('svg.ac-icon:not(.ac-icon-sprite)');
    for (const icon of renderedIcons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.getAttribute('focusable')).toBe('false');
    }
  });

  it('opens an accessible Nuevo mensaje dialog with discovery and nickname controls', () => {
    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.new-message-dialog') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.querySelector('label[for="new-message-nickname"]')?.textContent).toContain(
      'Apodo en salas',
    );
    expect(panel.querySelector('input[placeholder="Ej. operador"]')).toBeTruthy();
    expect(panel.textContent).toContain('No hay salas descubiertas todavía.');
  });
  it('opens the broadcast dialog with roster contacts instead of sample data', () => {
    facade.contacts.set([
      {
        jid: 'one@example.invalid',
        name: 'Uno',
        groups: ['Equipo'],
        source: 'roster',
        presence: {
          jid: 'one@example.invalid',
          availability: 'available',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      {
        jid: 'two@example.invalid',
        name: 'Dos',
        groups: ['Equipo'],
        source: 'roster',
        presence: {
          jid: 'two@example.invalid',
          availability: 'unavailable',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.broadcast-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.broadcast-dialog') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.querySelector('textarea[name="broadcast-message"]')).toBeTruthy();
    expect(panel.querySelectorAll('.broadcast-contact')).toHaveLength(2);
    expect(panel.textContent).toContain('Equipo');
    expect(panel.textContent).toContain('Notificación de alerta');
  });
  it('separates room selection from joining', () => {
    muc.services.set([
      {
        service: 'conference.example.invalid',
        room: 'lobby',
        jid: 'lobby@conference.example.invalid',
      },
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.new-message-dialog') as HTMLElement;
    const join = panel.querySelector('.new-message-room button') as HTMLButtonElement;
    join.click();
    expect(muc.join).toHaveBeenCalledWith(
      'a@example.invalid',
      'lobby@conference.example.invalid',
      'a',
    );
    expect(fixture.nativeElement.querySelector('.new-message-dialog')).toBeTruthy();
  });
  it('selects a contact or a valid new JID from the independent dialog search', () => {
    const contact = {
      jid: 'contact@example.invalid',
      name: 'Contacto',
      groups: [],
      source: 'roster' as const,
    };
    facade.contacts.set([contact]);
    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.new-message-result') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((fixture.componentInstance as any).selectedJid()).toBe(contact.jid);
    expect(fixture.nativeElement.querySelector('.new-message-dialog')).toBeNull();

    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    (fixture.componentInstance as any).newMessageSearch.set('new@example.invalid');
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('.new-message-search button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect((fixture.componentInstance as any).selectedJid()).toBe('new@example.invalid');
  });
  it('keeps the dialog open on failed room join and closes after confirmation', async () => {
    const room = {
      service: 'conference.example.invalid',
      room: 'lobby',
      jid: 'lobby@conference.example.invalid',
    };
    muc.services.set([room]);
    (
      muc.join as unknown as { mockImplementation: (implementation: () => Promise<void>) => void }
    ).mockImplementation(async () => muc.error.set('No fue posible unirse a la sala.'));
    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.new-message-room button') as HTMLButtonElement).click();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.new-message-dialog')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('No fue posible unirse a la sala.');

    (
      muc.join as unknown as { mockImplementation: (implementation: () => Promise<void>) => void }
    ).mockImplementation(async () => muc.states.set([joinedRoom(room)]));
    (fixture.nativeElement.querySelector('.new-message-room button') as HTMLButtonElement).click();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.new-message-dialog')).toBeNull();
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeTruthy();
  });
  it('hides a closed conversation without deleting it and reveals it from Nuevo mensaje', () => {
    const contact = {
      jid: 'contact@example.invalid',
      name: 'Contacto',
      groups: [],
      source: 'roster' as const,
    };
    facade.contacts.set([contact]);
    facade.preferences.set({
      theme: 'atomic',
      notifications: true,
      autoAcceptFileTransfers: false,
      autoLogin: false,
      hideClosedConversations: true,
      fileTransferTimeoutSeconds: 300,
      downloadDirectory: '',
    });
    fixture.detectChanges();
    (fixture.componentInstance as any).dismissConversationByUser();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Contacto');
    expect(facade.contacts()).toContain(contact);

    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.new-message-result') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Contacto');
  });
  it('shows the local discovery state without duplicating IPC actions', async () => {
    let release!: () => void;
    (
      muc.discover as unknown as {
        mockImplementationOnce: (implementation: () => Promise<void>) => void;
      }
    ).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    const discoverButton = fixture.nativeElement.querySelector(
      '.new-message-discover',
    ) as HTMLButtonElement;
    discoverButton.click();
    fixture.detectChanges();
    expect(discoverButton.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Consultando salas');
    release();
    await Promise.resolve();
    fixture.detectChanges();
    expect(discoverButton.disabled).toBe(false);
    expect(muc.discover).toHaveBeenCalledTimes(1);
  });

  it('keeps joined rooms in navigation while switching to a direct chat', async () => {
    const room = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    muc.states.set([joinedRoom(room)]);
    facade.contacts.set([
      { jid: 'luis@example.invalid', name: 'Luis', groups: [], source: 'roster' },
    ]);
    muc.messages.set([mucMessage(room.jid, 'mensaje reservado')]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')?.textContent).toContain(
      'sala-pro',
    );
    (
      fixture.nativeElement.querySelector(
        '.conversation-item:not(.muc-conversation-item)',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chat-header')?.textContent).toContain('Luis');
    expect(muc.leave).not.toHaveBeenCalled();
    expect(muc.states()[0].status).toBe('joined');
    expect(fixture.nativeElement.textContent).not.toContain('mensaje reservado');
    muc.messages.set([mucMessage(room.jid, 'mensaje mientras Luis estaba activo')]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('mensaje mientras Luis estaba activo');
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')?.textContent).toContain(
      'mensaje mientras Luis estaba activo',
    );
    await Promise.resolve();
  });
  it('switches between two joined rooms without joining again', () => {
    const first = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    const second = {
      service: 'conference.example.invalid',
      room: 'soporte',
      jid: 'soporte@conference.example.invalid',
    };
    muc.states.set([joinedRoom(first), joinedRoom(second)]);
    fixture.detectChanges();
    const rooms = fixture.nativeElement.querySelectorAll(
      '.muc-conversation-item',
    ) as NodeListOf<HTMLButtonElement>;
    rooms[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-header')?.textContent).toContain('sala-pro');
    rooms[1].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-header')?.textContent).toContain('soporte');
    expect(muc.join).not.toHaveBeenCalled();
    expect(muc.select).toHaveBeenCalledWith(second.jid);
  });
  it('closes a MUC view without leaving the joined room', () => {
    const room = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    muc.states.set([joinedRoom(room)]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.conversation-close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeNull();
    expect(muc.selectedRoomJid()).toBe('');
    expect(muc.leave).not.toHaveBeenCalled();
    expect(muc.states()[0].status).toBe('joined');
  });
  it('leaves one room while keeping another joined and navigable', async () => {
    const first = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    const second = {
      service: 'conference.example.invalid',
      room: 'soporte',
      jid: 'soporte@conference.example.invalid',
    };
    muc.states.set([joinedRoom(first), joinedRoom(second)]);
    (
      muc.leave as unknown as {
        mockImplementationOnce: (
          implementation: (accountId: string, roomJid: string) => Promise<void>,
        ) => void;
      }
    ).mockImplementationOnce(async (_accountId, roomJid) => {
      muc.states.set(
        muc
          .states()
          .map((state) => (state.room.jid === roomJid ? { ...state, status: 'idle' } : state)),
      );
    });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-room-meta button') as HTMLButtonElement).click();
    await Promise.resolve();
    fixture.detectChanges();
    expect(muc.leave).toHaveBeenCalledWith('a@example.invalid', first.jid);
    expect(fixture.nativeElement.querySelectorAll('.muc-conversation-item')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.muc-conversation-item')?.textContent).toContain(
      'soporte',
    );
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeNull();
  });
  it('does not carry a MUC view across an account switch and reconnect', async () => {
    const room = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    muc.states.set([joinedRoom(room)]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeTruthy();
    (fixture.componentInstance as any).login.set({ accountId: 'b@example.invalid', password: '' });
    await (fixture.componentInstance as any).connect();
    facade.accountId.set('b@example.invalid');
    muc.states.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeNull();
    (fixture.componentInstance as any).login.set({ accountId: 'a@example.invalid', password: '' });
    await (fixture.componentInstance as any).connect();
    facade.accountId.set('a@example.invalid');
    muc.states.set([joinedRoom(room)]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeNull();
    expect(muc.setAccount).toHaveBeenCalledWith('b@example.invalid');
    expect(muc.setAccount).toHaveBeenCalledWith('a@example.invalid');
  });
  it('routes each composer to the destination visible on screen', async () => {
    const room = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    muc.states.set([joinedRoom(room)]);
    facade.contacts.set([
      { jid: 'luis@example.invalid', name: 'Luis', groups: [], source: 'roster' },
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.componentInstance as any).mucDraft.set('mensaje de sala');
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('.muc-room-view form.composer').requestSubmit();
    expect(muc.send).toHaveBeenCalledWith('a@example.invalid', room.jid, 'mensaje de sala');
    (
      fixture.nativeElement.querySelector(
        '.conversation-item:not(.muc-conversation-item)',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (fixture.componentInstance as any).draft.set('mensaje directo');
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect(facade.send).toHaveBeenCalledWith('mensaje directo', 'luis@example.invalid');
  });
  it('renders every MUC sender from the message occupant and preserves labels after departure', () => {
    const room = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    const state = { ...joinedRoom(room), selfOccupantJid: `${room.jid}/juan.munoz` };
    muc.states.set([state]);
    muc.messages.set([
      { ...mucMessage(room.jid, 'Luis'), id: 'luis-1', occupantJid: `${room.jid}/luis.pasteur` },
      { ...mucMessage(room.jid, 'Juan'), id: 'juan', occupantJid: `${room.jid}/juan.munoz` },
      { ...mucMessage(room.jid, 'Maria'), id: 'maria', occupantJid: `${room.jid}/maria` },
      {
        ...mucMessage(room.jid, 'Luis otra vez'),
        id: 'luis-2',
        occupantJid: `${room.jid}/luis.pasteur`,
      },
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    const messages = fixture.nativeElement.querySelectorAll(
      '.muc-messages .message',
    ) as NodeListOf<HTMLElement>;
    expect(
      [...messages].map((message) => message.querySelector('.message-sender')?.textContent?.trim()),
    ).toEqual(['luis.pasteur', 'Tú · juan.munoz', 'maria', 'luis.pasteur']);
    expect(messages[0].classList.contains('incoming')).toBe(true);
    expect(messages[1].classList.contains('outgoing')).toBe(true);
    muc.states.set([{ ...state, participants: [] }]);
    fixture.detectChanges();
    expect(
      [...fixture.nativeElement.querySelectorAll('.message-sender')].map((sender: Element) =>
        sender.textContent?.trim(),
      ),
    ).toEqual(['luis.pasteur', 'Tú · juan.munoz', 'maria', 'luis.pasteur']);
  });
  it('uses safe fallbacks for unknown MUC nicknames and escapes external text', () => {
    const room = {
      service: 'conference.example.invalid',
      room: 'sala-pro',
      jid: 'sala-pro@conference.example.invalid',
    };
    muc.states.set([joinedRoom(room)]);
    muc.messages.set([
      {
        ...mucMessage(room.jid, '<b>texto</b>'),
        id: 'unsafe',
        occupantJid: `${room.jid}/<script>alert(1)</script>`,
      },
      { ...mucMessage(room.jid, 'sin apodo'), id: 'unknown', occupantJid: room.jid },
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.muc-conversation-item') as HTMLButtonElement).click();
    fixture.detectChanges();
    const messages = fixture.nativeElement.querySelectorAll(
      '.muc-messages .message',
    ) as NodeListOf<HTMLElement>;
    expect(messages[0].querySelector('.message-sender')?.textContent).toBe(
      '<script>alert(1)</script>',
    );
    expect(messages[0].querySelector('.message-sender')?.innerHTML).not.toContain('<script>');
    expect(messages[0].textContent).toContain('<b>texto</b>');
    expect(messages[1].querySelector('.message-sender')?.textContent).toBe(
      'Participante desconocido',
    );
  });
  it('renders direct aliases, bare JIDs, and the local sender without account mixing', () => {
    facade.contacts.set([
      { jid: 'luis@example.invalid', name: 'Luis Pasteur', groups: [], source: 'roster' },
      { jid: 'sin-alias@example.invalid', name: '  ', groups: [], source: 'roster' },
    ]);
    facade.messages.set([
      directMessage('luis@example.invalid', 'alias', 'direct-alias'),
      directMessage('sin-alias@example.invalid', 'jid', 'direct-jid'),
      directMessage('a@example.invalid', 'propio', 'direct-own'),
      {
        ...directMessage('luis@example.invalid', 'otra cuenta', 'direct-other'),
        accountId: 'b@example.invalid',
      },
    ]);
    fixture.detectChanges();
    const labels = [...fixture.nativeElement.querySelectorAll('.chat-content .message-sender')].map(
      (sender: Element) => sender.textContent?.trim(),
    );
    expect(labels).toEqual(['Luis Pasteur', 'sin-alias@example.invalid', 'Tú']);
    expect(fixture.nativeElement.querySelectorAll('.chat-content .message')).toHaveLength(3);
  });
  it('clears only after local acceptance', async () => {
    const input = fixture.nativeElement.querySelector('input[name="message"]');
    input.value = 'hola';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    fixture.detectChanges();
    expect((fixture.componentInstance as any).draft()).toBe('');
  });
  it('closes the active conversation without leaving a MUC or preserving its draft', () => {
    const app = fixture.componentInstance as any;
    app.draft.set('borrador directo');
    app.closeActiveConversation();
    fixture.detectChanges();
    expect(app.selectedJid()).toBe('');
    expect(app.draft()).toBe('');
    expect(app.mucDraft()).toBe('');
    expect(muc.leave).not.toHaveBeenCalled();
  });
  it('closes the active conversation on Escape and leaves modal priority intact', () => {
    const close = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(close);
    fixture.detectChanges();
    expect((fixture.componentInstance as any).selectedJid()).toBe('');

    (fixture.componentInstance as any).conversationSelection.set({
      kind: 'direct',
      accountId: 'a@example.invalid',
      jid: 'contact@example.invalid',
    });
    facade.certificateRequest.set({
      requestId: 'cert-priority',
      accountId: 'a@example.invalid',
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
    });
    fixture.detectChanges();
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    expect((fixture.componentInstance as any).selectedJid()).toBe('contact@example.invalid');
  });
  it('prevents file navigation outside the conversation without intercepting text drops', () => {
    const fileDrop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(fileDrop, 'dataTransfer', {
      value: { types: ['Files'], items: [], files: [], dropEffect: 'none' },
    });
    document.body.dispatchEvent(fileDrop);
    expect(fileDrop.defaultPrevented).toBe(true);

    const textDrop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(textDrop, 'dataTransfer', {
      value: { types: ['text/plain'], items: [], files: [], dropEffect: 'none' },
    });
    document.body.dispatchEvent(textDrop);
    expect(textDrop.defaultPrevented).toBe(false);
  });
  it('shows one certificate dialog with the selected transport and fingerprint', () => {
    facade.certificateRequest.set({
      requestId: 'cert-1',
      accountId: 'a@example.invalid',
      host: 'xmpp.example.invalid',
      port: 5222,
      transport: 'starttls',
      certificate: {
        fingerprintSha256: 'AA:BB',
        subject: 'CN=xmpp.example.invalid',
        issuer: 'CN=xmpp.example.invalid',
        validFrom: '2026-01-01',
        validTo: '2027-01-01',
        subjectAltNames: ['DNS:xmpp.example.invalid'],
        chain: [
          {
            fingerprintSha256: 'AA:BB',
            subject: 'CN=xmpp.example.invalid',
            issuer: 'CN=xmpp.example.invalid',
          },
        ],
        pem: 'pem',
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('STARTTLS');
    expect(fixture.nativeElement.textContent).toContain('AA:BB');
    expect(fixture.nativeElement.querySelectorAll('.certificate-actions button').length).toBe(3);
  });
  it('preserves the draft after a failed result or exception', async () => {
    const send = facade.send as any;
    send.mockResolvedValueOnce(false);
    const input = fixture.nativeElement.querySelector('input[name="message"]');
    input.value = 'reintentar';
    input.dispatchEvent(new Event('input'));
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect((fixture.componentInstance as any).draft()).toBe('reintentar');
    send.mockRejectedValueOnce(new Error('ipc'));
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect((fixture.componentInstance as any).draft()).toBe('reintentar');
  });
  it('preserves newer content while an earlier send is pending', async () => {
    let resolve!: (value: boolean) => void;
    const send = facade.send as any;
    send.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const input = fixture.nativeElement.querySelector('input[name="message"]');
    input.value = 'viejo';
    input.dispatchEvent(new Event('input'));
    const pending = fixture.nativeElement.querySelector('form.composer').requestSubmit();
    input.value = 'nuevo';
    input.dispatchEvent(new Event('input'));
    resolve(true);
    await pending;
    expect((fixture.componentInstance as any).draft()).toBe('nuevo');
  });
  it('preserves text when the account is disconnected', async () => {
    const send = facade.send as any;
    send.mockResolvedValueOnce(false);
    const input = fixture.nativeElement.querySelector('input[name="message"]');
    input.value = 'sin conexión';
    input.dispatchEvent(new Event('input'));
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect((fixture.componentInstance as any).draft()).toBe('sin conexión');
  });
  it('shows an accessible error after an IPC exception', async () => {
    const send = facade.send as any;
    send.mockRejectedValueOnce(new Error('ipc'));
    const input = fixture.nativeElement.querySelector('input[name="message"]');
    input.value = 'error';
    input.dispatchEvent(new Event('input'));
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    fixture.detectChanges();
    expect((fixture.componentInstance as any).draft()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('No fue posible enviar el mensaje.');
  });
  it('does not clear a draft after the conversation context changes', async () => {
    let resolve!: (value: boolean) => void;
    const send = facade.send as any;
    send.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const input = fixture.nativeElement.querySelector('input[name="message"]');
    input.value = 'cuenta A';
    input.dispatchEvent(new Event('input'));
    const pending = fixture.nativeElement.querySelector('form.composer').requestSubmit();
    (fixture.componentInstance as any).conversationSelection.set({
      kind: 'direct',
      accountId: 'a@example.invalid',
      jid: 'other@example.invalid',
    });
    input.value = 'cuenta B';
    input.dispatchEvent(new Event('input'));
    resolve(true);
    await pending;
    expect((fixture.componentInstance as any).draft()).toBe('cuenta B');
  });
  it('follows an incoming message, preserves old-message reading, and resumes at the end', async () => {
    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    let height = 1000;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 300 },
    });
    facade.messages.set([chatMessage('inicio', 'm1')] as any);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(700);
    height = 1050;
    facade.messages.set([...facade.messages(), chatMessage('😀 recibido', 'm2')] as any);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(750);
    area.scrollTop = 120;
    (fixture.componentInstance as any).onUserScrollIntent();
    await Promise.resolve();
    height = 1100;
    facade.messages.set([...facade.messages(), chatMessage('antiguo', 'm3')] as any);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(120);
    area.scrollTop = 800;
    (fixture.componentInstance as any).onUserScrollIntent();
    await Promise.resolve();
    height = 1150;
    facade.messages.set([...facade.messages(), chatMessage('vuelve', 'm4')] as any);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(850);
  });
  it('continues following the second and third consecutive incoming messages', async () => {
    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    let height = 1000;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 300 },
    });
    facade.messages.set([chatMessage('uno', 'm1')] as any);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    height = 1050;
    facade.messages.set([...facade.messages(), chatMessage('dos', 'm2')] as any);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(750);
    height = 1100;
    facade.messages.set([...facade.messages(), chatMessage('tres', 'm3')] as any);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(800);
  });
  it('scrolls a newly selected conversation after asynchronous history rendering', async () => {
    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 300 },
    });
    facade.messages.set([chatMessage('último B', 'b1')] as any);
    fixture.detectChanges();
    (fixture.componentInstance as any).conversationSelection.set({
      kind: 'direct',
      accountId: 'a@example.invalid',
      jid: 'other@example.invalid',
    });
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(900);
  });
  it('preserves the visual position when prepending an older page', async () => {
    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    let height = 1000;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 300 },
    });
    await new Promise(requestAnimationFrame);
    facade.hasOlderMessages.set(true);
    (facade.loadOlderMessages as any).mockImplementationOnce(async () => {
      height = 1200;
    });
    area.scrollTop = 0;
    (fixture.componentInstance as any).onChatScroll();
    await Promise.resolve();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(200);
    expect(facade.loadOlderMessages).toHaveBeenCalledTimes(1);
  });
  it('does not repeat an older-page request while one is loading', async () => {
    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
    });
    facade.hasOlderMessages.set(true);
    facade.historyLoading.set(true);
    area.scrollTop = 0;
    (fixture.componentInstance as any).onChatScroll();
    expect(facade.loadOlderMessages).not.toHaveBeenCalled();
  });
  it('closes the presence popover and restores focus through the shell', async () => {
    const trigger = fixture.nativeElement.querySelector('.presence-trigger') as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector(
      'input[aria-label="Mensaje de estado"]',
    ) as HTMLInputElement;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await Promise.resolve();
    expect(fixture.nativeElement.querySelector('.presence-popover')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('keeps profile state after failed operations and clears credentials on identity changes', async () => {
    facade.profiles.set([
      {
        accountId: 'a@example.invalid',
        domain: 'example.invalid',
        mode: 'automatic',
        updatedAt: '2026-10-29',
        hasPersistentCredential: true,
      },
    ]);
    (facade.isConnected as unknown as { set: (value: boolean) => void }).set(false);
    fixture.detectChanges();
    const app = fixture.componentInstance as any;
    await app.selectLoginProfile('a@example.invalid');
    app.setLoginPassword('password-a');
    (
      facade.forgetSecret as unknown as {
        mockResolvedValueOnce: (value: boolean) => void;
      }
    ).mockResolvedValueOnce(false);
    await app.forgetLoginSecret();
    expect(app.selectedProfileId()).toBe('a@example.invalid');
    expect(app.login().password).toBe('password-a');
    expect(app.login().remember).toBe(true);
    app.setLoginAccount('b');
    expect(app.selectedProfileId()).toBe('');
    expect(app.login().password).toBe('');
    expect(app.login().remember).toBe(false);
    await app.selectLoginProfile('a@example.invalid');
    (
      facade.deleteProfile as unknown as {
        mockResolvedValueOnce: (value: boolean) => void;
      }
    ).mockResolvedValueOnce(false);
    await app.deleteLoginProfile();
    expect(app.selectedProfileId()).toBe('a@example.invalid');
    (
      facade.forgetSecret as unknown as {
        mockResolvedValueOnce: (value: boolean) => void;
      }
    ).mockResolvedValueOnce(true);
    await app.forgetLoginSecret();
    expect(app.login().remember).toBe(false);
    (
      facade.deleteProfile as unknown as {
        mockResolvedValueOnce: (value: boolean) => void;
      }
    ).mockResolvedValueOnce(true);
    await app.deleteLoginProfile();
    expect(app.selectedProfileId()).toBe('');
  });
  it('persists advanced settings for an existing legacy profile without changing its identity', async () => {
    facade.profiles.set([
      {
        accountId: 'juan',
        domain: '',
        mode: 'manual',
        manualEndpoint: { host: 'old.example.invalid', port: 5222, transport: 'starttls' },
        updatedAt: '2026-10-29',
        hasPersistentCredential: true,
      },
    ]);
    (facade.isConnected as unknown as { set: (value: boolean) => void }).set(false);
    fixture.detectChanges();
    const app = fixture.componentInstance as any;
    await app.selectLoginProfile('juan');
    app.setLoginDomain('localhost');
    await app.saveAdvancedSettings({
      automatic: false,
      host: '192.168.1.20',
      port: 5223,
      transport: 'direct-tls',
    });
    expect(facade.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'juan',
        domain: 'localhost',
        mode: 'manual',
        manualEndpoint: {
          host: '192.168.1.20',
          port: 5223,
          transport: 'direct-tls',
        },
      }),
    );
    expect(app.selectedProfileId()).toBe('juan');
  });
});
