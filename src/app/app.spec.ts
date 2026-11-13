import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { App } from './app';
import { ChatFacade } from './core/facades/chat.facade';
import type { InitialHistoryState } from './core/facades/chat.facade';
import {
  CertificateTrustRequest,
  Contact,
  HistoryTimelineItem,
  Message,
  MessageSearchHit,
  RoomMessage,
  RoomRef,
  RoomState,
  FileTransfer,
  TypedDomainEvent,
} from './core/domain';
import { MucFacade } from './core/facades/muc.facade';
import { FileFacade } from './core/facades/file.facade';
import { corePortProviders } from './core/ports/port-providers';
import { BROADCAST_PORT, FILE_TRANSFER_PORT } from './core/ports';
import { UnavailableFileTransferPort } from './core/ports/unavailable.ports';
import type { LoginDraft } from './core/coordinators/app-session.coordinator';
import type { ConversationSelection } from './core/coordinators/workspace.coordinator';
import type { ConnectionSettingsDraft } from './features/settings/connection-settings-dialog.component';

interface AppTestSurface {
  readonly conversationSelection: WritableSignal<ConversationSelection>;
  readonly selectedJid: () => string;
  readonly newMessageSearch: WritableSignal<string>;
  readonly login: WritableSignal<LoginDraft>;
  readonly mucDraft: WritableSignal<string>;
  readonly draft: WritableSignal<string>;
  readonly activeContact: () => Contact | undefined;
  readonly contactsByBareJid: () => ReadonlyMap<string, Contact>;
  readonly stickerMessages: {
    send(accountId: string, conversationId: string, stickerId: string): Promise<unknown>;
  };
  dismissConversationByUser(): void;
  connect(): Promise<void>;
  sendSticker(stickerId: string): Promise<void>;
  closeActiveConversation(): void;
  onUserScrollIntent(): void;
  onChatScroll(): void;
  selectedProfileId(): string;
  selectLoginProfile(accountId: string): Promise<void>;
  setLoginPassword(password: string): void;
  setLoginAccount(accountId: string): void;
  forgetLoginSecret(): Promise<void>;
  deleteLoginProfile(): Promise<void>;
  setLoginDomain(domain: string): void;
  saveAdvancedSettings(settings: ConnectionSettingsDraft): Promise<void>;
}

function appSurface(fixture: ComponentFixture<App>): AppTestSurface {
  return fixture.componentInstance as unknown as AppTestSurface;
}

function fakeFacade() {
  const initialHistory = signal<InitialHistoryState>({
    accountId: 'a@example.invalid',
    conversationId: 'contact@example.invalid',
    generation: 1,
    status: 'ready' as const,
  });
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
    reactions: signal(new Map()),
    initialHistory,
    messageSearchResults: signal([]),
    messageSearchLoading: signal(false),
    messageSearchError: signal<string | null>(null),
    messageSearchHasMore: signal(false),
    searchMessages: vi.fn(async () => undefined),
    revealSearchHit: vi.fn(async () => undefined),
    timelineItems: signal<ReadonlyArray<HistoryTimelineItem>>([]),
    timelineSupported: signal(true),
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
    sendMessageWithReply: vi.fn(async () => true),
    updateTypingState: vi.fn(async () => undefined),
    setTypingActivity: vi.fn(async () => undefined),
    loadConversation: vi.fn(async (conversationId: string) => {
      initialHistory.set({
        accountId: 'a@example.invalid',
        conversationId: conversationId.split('/')[0].toLowerCase(),
        generation: initialHistory().generation + 1,
        status: 'loading',
      });
      initialHistory.update((current) => ({ ...current, status: 'ready' }));
    }),
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
    reactions: signal(new Map()),
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
  let broadcastSend: ReturnType<typeof vi.fn>;
  const chatMessage = (text: string, clientMessageId: string): Message => ({
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
    broadcastSend = vi.fn(async () => ({
      ok: true as const,
      version: 1 as const,
      requestId: 'broadcast-test',
      value: {
        broadcastId: 'broadcast-test',
        recipients: [
          {
            recipientJid: 'one@example.invalid',
            clientMessageId: 'client-test',
            status: 'submitted' as const,
          },
        ],
      },
    }));
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        ...corePortProviders,
        { provide: BROADCAST_PORT, useValue: { send: broadcastSend } },
        { provide: FILE_TRANSFER_PORT, useClass: UnavailableFileTransferPort },
        { provide: ChatFacade, useValue: facade },
        { provide: MucFacade, useValue: muc },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    appSurface(fixture).conversationSelection.set({
      kind: 'direct',
      accountId: 'a@example.invalid',
      jid: 'contact@example.invalid',
    });
    fixture.detectChanges();
  });

  it('loads Preferences on demand and restores focus when the dialog closes', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="Preferencias"]');
    expect(trigger).not.toBeNull();
    expect(root.querySelector('.preferences-dialog')).toBeNull();

    trigger?.focus();
    trigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await Promise.resolve();

    const dialog = root.querySelector<HTMLElement>('.preferences-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.contains(document.activeElement)).toBe(true);

    dialog?.querySelector<HTMLButtonElement>('[data-tab="notifications"]')?.click();
    fixture.detectChanges();
    // NgModel updates the checkbox control asynchronously after the tab is rendered.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(facade.preferences().notifications).toBe(true);
    const toggle = dialog?.querySelector<HTMLInputElement>(
      '#preferences-panel-notifications input[type="checkbox"]',
    );
    expect(toggle?.checked).toBe(true);
    toggle?.click();
    expect(facade.updatePreferences).toHaveBeenCalledWith({ notifications: false });

    dialog?.querySelector<HTMLButtonElement>('[aria-label="Cerrar Preferencias"]')?.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(root.querySelector('.preferences-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels the delayed message search when the app is destroyed', async () => {
    vi.useFakeTimers();
    try {
      const searchMessages = facade.searchMessages as ReturnType<typeof vi.fn>;
      (
        fixture.componentInstance as unknown as { searchMessages: (query: string) => void }
      ).searchMessages('late query');
      fixture.destroy();
      await vi.advanceTimersByTimeAsync(200);
      expect(searchMessages).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps global search navigation targeted after selecting another conversation', async () => {
    const app = fixture.componentInstance as unknown as {
      selectMessageSearchHit(hit: MessageSearchHit): Promise<void>;
      conversationView?: { scrollToMessage(messageId: string): void };
    };
    const scrollToMessage = vi.spyOn(app.conversationView!, 'scrollToMessage');
    const hit: MessageSearchHit = {
      messageId: 'message-b',
      accountId: 'a@example.invalid',
      conversationId: 'b@example.invalid',
      senderJid: 'b@example.invalid',
      bodyPreview: 'resultado B',
      createdAt: '2026-11-11T00:00:00.000Z',
    };

    await app.selectMessageSearchHit(hit);

    expect(facade.revealSearchHit).toHaveBeenCalledWith(hit);
    expect(scrollToMessage).toHaveBeenCalledOnce();
    expect(scrollToMessage).toHaveBeenCalledWith('message-b');
  });

  it('ignores an obsolete global search result after a newer selection', async () => {
    const app = fixture.componentInstance as unknown as {
      selectMessageSearchHit(hit: MessageSearchHit): Promise<void>;
      selectContact(contact: Contact): void;
      conversationView?: { scrollToMessage(messageId: string): void };
    };
    const scrollToMessage = vi.spyOn(app.conversationView!, 'scrollToMessage');
    const releases = new Map<string, () => void>();
    facade.revealSearchHit = vi.fn(
      (hit: MessageSearchHit) =>
        new Promise<void>((resolve) => {
          releases.set(hit.messageId, resolve);
        }),
    );
    const first: MessageSearchHit = {
      messageId: 'message-b',
      accountId: 'a@example.invalid',
      conversationId: 'b@example.invalid',
      senderJid: 'b@example.invalid',
      bodyPreview: 'resultado B',
      createdAt: '2026-11-11T00:00:00.000Z',
    };
    const second: MessageSearchHit = {
      messageId: 'message-c',
      accountId: 'a@example.invalid',
      conversationId: 'c@example.invalid',
      senderJid: 'c@example.invalid',
      bodyPreview: 'resultado C',
      createdAt: '2026-11-11T00:01:00.000Z',
    };

    const firstNavigation = app.selectMessageSearchHit(first);
    const secondNavigation = app.selectMessageSearchHit(second);
    releases.get('message-b')?.();
    await firstNavigation;

    expect(scrollToMessage).not.toHaveBeenCalled();

    releases.get('message-c')?.();
    await secondNavigation;
    expect(scrollToMessage).toHaveBeenCalledOnce();
    expect(scrollToMessage).toHaveBeenCalledWith('message-c');

    const manualContact: Contact = {
      jid: 'manual@example.invalid',
      name: 'Manual',
      groups: [],
      source: 'conversation',
    };
    const abandoned = app.selectMessageSearchHit(first);
    app.selectContact(manualContact);
    releases.get('message-b')?.();
    await abandoned;
    expect(scrollToMessage).toHaveBeenCalledOnce();
  });

  it('does not dismiss a conversation when Escape cancels a pending Preferences open', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="Preferencias"]');
    expect(trigger).not.toBeNull();

    trigger?.focus();
    trigger?.click();
    fixture.detectChanges();
    trigger?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await Promise.resolve();

    expect(
      (fixture.componentInstance as App & { preferencesOpen: () => boolean }).preferencesOpen(),
    ).toBe(false);
    expect((fixture.componentInstance as App & { selectedJid: () => string }).selectedJid()).toBe(
      'contact@example.invalid',
    );
    expect(root.querySelector('.preferences-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('renders one unique local SVG sprite with declared icon references', () => {
    const root = fixture.nativeElement as HTMLElement;
    const symbols = root.querySelectorAll<SVGSymbolElement>('svg.ac-icon-sprite symbol[id^="ac-"]');
    const ids = new Set(Array.from(symbols, (symbol) => symbol.id));

    expect(symbols).toHaveLength(26);
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

  it('publishes precached image records with their history page, never as an isolated early timeline', () => {
    const media = {
      mediaId: 'media-cached',
      transferId: 'transfer-cached',
      accountId: 'a@example.invalid',
      conversationId: 'contact@example.invalid',
      direction: 'incoming' as const,
      senderJid: 'contact@example.invalid',
      originalName: 'cached.jpg',
      mimeType: 'image/jpeg' as const,
      sizeBytes: '128',
      width: 320,
      height: 240,
      createdAt: '2026-11-01T10:00:00.000Z',
      availability: 'available' as const,
    };
    const files = TestBed.inject(FileFacade);
    (files as unknown as { onEvent(event: TypedDomainEvent): void }).onEvent({
      version: 1,
      eventId: 'media-event',
      type: 'media.available',
      payload: media,
    });
    facade.initialHistory.set({
      accountId: 'a@example.invalid',
      conversationId: 'contact@example.invalid',
      generation: 2,
      status: 'loading',
    });
    facade.messages.set([chatMessage('historial unificado', 'history-message')]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.file-message')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('Cargando conversación');

    facade.timelineItems.set([
      {
        kind: 'text',
        id: 'history-message',
        sortAt: '2026-11-01T09:00:00.000Z',
        message: chatMessage('historial unificado', 'history-message'),
      },
      { kind: 'image', id: 'media-cached', sortAt: media.createdAt, media },
    ]);
    facade.initialHistory.set({
      accountId: 'a@example.invalid',
      conversationId: 'contact@example.invalid',
      generation: 2,
      status: 'ready',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('historial unificado');
    expect(fixture.nativeElement.querySelectorAll('.file-message')).toHaveLength(1);
  });

  it('hides only cancelled outgoing images while retaining their internal transfer record', async () => {
    const files = TestBed.inject(FileFacade);
    await fixture.whenStable();
    const createTransfer = (transferId: string, changes: Partial<FileTransfer>): FileTransfer => ({
      offer: {
        transferId,
        accountId: 'a@example.invalid',
        conversationId: 'contact@example.invalid',
        senderJid: 'a@example.invalid',
        name: `${transferId}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: '12',
        transport: 'ibb',
        offeredAt: `2026-11-01T10:00:0${transferId.length}.000Z`,
      },
      direction: 'outgoing',
      state: 'transferring',
      bytesTransferred: '4',
      updatedAt: '2026-11-01T10:00:00.000Z',
      ...changes,
    });
    const emit = (transfer: FileTransfer): void => {
      (files as unknown as { onEvent(event: TypedDomainEvent): void }).onEvent({
        version: 1,
        eventId: transfer.offer.transferId,
        type: 'file.stateChanged',
        payload: transfer,
      });
    };
    const cancelledImage = createTransfer('cancelled-image', {
      state: 'cancelled',
      endReason: 'cancelled_by_sender',
      bytesTransferred: '0',
    });
    emit(cancelledImage);
    emit(createTransfer('active-image', { state: 'transferring' }));
    emit(
      createTransfer('completed-image', {
        state: 'completed',
        bytesTransferred: '12',
      }),
    );
    emit({
      ...createTransfer('cancelled-document', {
        state: 'cancelled',
        endReason: 'cancelled_by_sender',
      }),
      offer: {
        ...createTransfer('cancelled-document', {}).offer,
        name: 'cancelled-document.pdf',
        mimeType: 'application/pdf',
      },
    });
    fixture.detectChanges();

    expect(files.transfers()).toContainEqual(cancelledImage);
    expect(
      fixture.nativeElement.querySelector('[aria-label="Archivo saliente cancelled-image.jpg"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Archivo saliente active-image.jpg"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Archivo saliente completed-image.jpg"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Archivo saliente cancelled-document.pdf"]'),
    ).not.toBeNull();
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
  it('loads Difusión on demand and returns keyboard focus to its sidebar trigger', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('.broadcast-toggle');
    expect(trigger).not.toBeNull();
    expect(root.querySelector('.broadcast-dialog')).toBeNull();

    trigger?.focus();
    trigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await Promise.resolve();

    const dialog = root.querySelector<HTMLElement>('.broadcast-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    expect(dialog?.querySelector('textarea[name="broadcast-message"]')).not.toBeNull();

    dialog?.querySelector<HTMLButtonElement>('[aria-label="Cerrar Difundir mensaje"]')?.click();
    fixture.detectChanges();
    await Promise.resolve();
    expect(root.querySelector('.broadcast-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('cancels a pending Difusión open on Escape without closing the active conversation', async () => {
    const root = fixture.nativeElement as HTMLElement;
    const trigger = root.querySelector<HTMLButtonElement>('.broadcast-toggle');
    expect(trigger).not.toBeNull();

    trigger?.focus();
    trigger?.click();
    fixture.detectChanges();
    trigger?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await Promise.resolve();

    const state = fixture.componentInstance as App & {
      broadcastOpen: () => boolean;
      selectedJid: () => string;
    };
    expect(state.broadcastOpen()).toBe(false);
    expect(state.selectedJid()).toBe('contact@example.invalid');
    expect(root.querySelector('.broadcast-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('opens the broadcast dialog with roster contacts instead of sample data', async () => {
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
    await fixture.whenStable();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.broadcast-dialog') as HTMLElement;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.querySelector('textarea[name="broadcast-message"]')).toBeTruthy();
    expect(panel.querySelectorAll('.broadcast-contact')).toHaveLength(2);
    expect(panel.textContent).toContain('Equipo');
    expect(panel.textContent).toContain('Notificación de alerta');
  });
  it('closes the broadcast dialog after OK completes a successful send', async () => {
    facade.contacts.set([
      { jid: 'one@example.invalid', name: 'Uno', groups: [], source: 'roster' },
    ]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.broadcast-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.broadcast-dialog') as HTMLElement;
    const state = fixture.componentInstance as unknown as {
      broadcastBody: { set(value: string): void };
      broadcastSelectedJids: { set(value: ReadonlySet<string>): void };
    };
    state.broadcastBody.set('hola');
    state.broadcastSelectedJids.set(new Set(['one@example.invalid']));
    fixture.detectChanges();
    (panel.querySelector('button.primary') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(broadcastSend).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('.broadcast-dialog')).toBeNull();
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
    expect(appSurface(fixture).selectedJid()).toBe(contact.jid);
    expect(fixture.nativeElement.querySelector('.new-message-dialog')).toBeNull();

    (fixture.nativeElement.querySelector('.directory-toggle') as HTMLButtonElement).click();
    appSurface(fixture).newMessageSearch.set('new@example.invalid');
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector('.new-message-search button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(appSurface(fixture).selectedJid()).toBe('new@example.invalid');
  });
  it('does not reload the conversation when selecting the already active contact', () => {
    const app = fixture.componentInstance as unknown as {
      selectContact(contact: Contact): void;
    };
    const activeContact: Contact = {
      jid: 'contact@example.invalid/resource',
      name: 'Contacto activo',
      groups: [],
      source: 'conversation',
    };

    app.selectContact(activeContact);

    expect(facade.loadConversation).not.toHaveBeenCalled();
    expect(appSurface(fixture).selectedJid()).toBe('contact@example.invalid');
  });
  it('focuses the composer after starting a direct reply', async () => {
    const app = fixture.componentInstance as unknown as {
      startReply(message: Message, muc: boolean): void;
    };
    const message = {
      ...chatMessage('mensaje citado', 'reply-message'),
      messageId: 'reply-message',
    };

    app.startReply(message, false);
    await Promise.resolve();
    fixture.detectChanges();

    expect(document.activeElement).toBe(
      fixture.nativeElement.querySelector('.composer-input-row textarea'),
    );
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
    appSurface(fixture).dismissConversationByUser();
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
    appSurface(fixture).login.update((value) => ({
      ...value,
      accountId: 'b@example.invalid',
      password: '',
    }));
    await appSurface(fixture).connect();
    facade.accountId.set('b@example.invalid');
    muc.states.set([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.muc-room-view')).toBeNull();
    appSurface(fixture).login.update((value) => ({
      ...value,
      accountId: 'a@example.invalid',
      password: '',
    }));
    await appSurface(fixture).connect();
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
    appSurface(fixture).mucDraft.set('mensaje de sala');
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('.muc-room-view form.composer').requestSubmit();
    expect(muc.send).toHaveBeenCalledWith(
      'a@example.invalid',
      room.jid,
      'mensaje de sala',
      undefined,
    );
    (
      fixture.nativeElement.querySelector(
        '.conversation-item:not(.muc-conversation-item)',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    appSurface(fixture).draft.set('mensaje directo');
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect(facade.sendMessageWithReply).toHaveBeenCalledWith(
      'mensaje directo',
      'luis@example.invalid',
      undefined,
    );
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
  it('reactively indexes roster contacts without changing the active contact identity', () => {
    const active = {
      jid: 'Contact@Example.invalid/mobile',
      name: 'Contact display name',
      groups: ['friends'],
      source: 'roster' as const,
    };
    const second = {
      jid: 'CONTACT@example.invalid/desktop',
      name: 'Second resource',
      groups: [],
      source: 'roster' as const,
    };
    facade.contacts.set([active, second]);
    fixture.detectChanges();

    const root = appSurface(fixture);
    expect(root.activeContact()).toBe(active);
    expect(root.contactsByBareJid().size).toBe(1);

    const refreshed = { ...active, jid: 'contact@example.invalid', name: 'Updated contact' };
    facade.contacts.set([refreshed]);
    fixture.detectChanges();
    expect(root.activeContact()).toBe(refreshed);
    expect(root.contactsByBareJid().get('contact@example.invalid')).toBe(refreshed);
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
    const input = fixture.nativeElement.querySelector('textarea[name="message"]');
    input.value = 'hola';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    fixture.detectChanges();
    expect(facade.sendMessageWithReply).toHaveBeenCalledWith(
      'hola',
      'contact@example.invalid',
      undefined,
    );
    expect(appSurface(fixture).draft()).toBe('');
  });
  it('does not invoke the sticker service while sticker sending is disabled', async () => {
    const stickerSend = vi.fn();
    appSurface(fixture).stickerMessages.send = stickerSend;
    await appSurface(fixture).sendSticker('s1');
    expect(stickerSend).not.toHaveBeenCalled();
    expect(facade.error()).toBe('El envío de stickers está temporalmente deshabilitado');
  });
  it('closes the active conversation without leaving a MUC or preserving its draft', () => {
    const app = appSurface(fixture);
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
    expect(appSurface(fixture).selectedJid()).toBe('');

    appSurface(fixture).conversationSelection.set({
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
    expect(appSurface(fixture).selectedJid()).toBe('contact@example.invalid');
  });
  it('does not close the conversation while an image preview overlay is open', () => {
    const overlay = document.createElement('div');
    overlay.className = 'file-preview-overlay';
    document.body.append(overlay);

    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(appSurface(fixture).selectedJid()).toBe('contact@example.invalid');
    } finally {
      overlay.remove();
    }
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
    const send = vi.mocked(facade.sendMessageWithReply);
    send.mockResolvedValueOnce(false);
    const input = fixture.nativeElement.querySelector('textarea[name="message"]');
    input.value = 'reintentar';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect(appSurface(fixture).draft()).toBe('reintentar');
    send.mockRejectedValueOnce(new Error('ipc'));
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect(appSurface(fixture).draft()).toBe('reintentar');
  });
  it('preserves newer content while an earlier send is pending', async () => {
    let resolve!: (value: boolean) => void;
    const send = vi.mocked(facade.sendMessageWithReply);
    send.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const input = fixture.nativeElement.querySelector('textarea[name="message"]');
    input.value = 'viejo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect(send).toHaveBeenCalledOnce();
    input.value = 'nuevo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    resolve(true);
    await Promise.resolve();
    fixture.detectChanges();
    expect(appSurface(fixture).draft()).toBe('nuevo');
  });
  it('preserves text when the account is disconnected', async () => {
    const send = vi.mocked(facade.sendMessageWithReply);
    send.mockResolvedValueOnce(false);
    const input = fixture.nativeElement.querySelector('textarea[name="message"]');
    input.value = 'sin conexión';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect(send).toHaveBeenCalledWith('sin conexión', 'contact@example.invalid', undefined);
    expect(appSurface(fixture).draft()).toBe('sin conexión');
  });
  it('shows an accessible error after an IPC exception', async () => {
    const send = vi.mocked(facade.sendMessageWithReply);
    send.mockRejectedValueOnce(new Error('ipc'));
    const input = fixture.nativeElement.querySelector('textarea[name="message"]');
    input.value = 'error';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.nativeElement.querySelector('form.composer').requestSubmit();
    fixture.detectChanges();
    expect(send).toHaveBeenCalledWith('error', 'contact@example.invalid', undefined);
    expect(appSurface(fixture).draft()).toBe('error');
    expect(fixture.nativeElement.textContent).toContain('No fue posible enviar el mensaje.');
  });
  it('does not clear a draft after the conversation context changes', async () => {
    let resolve!: (value: boolean) => void;
    const send = vi.mocked(facade.sendMessageWithReply);
    send.mockImplementationOnce(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    const input = fixture.nativeElement.querySelector('textarea[name="message"]');
    input.value = 'cuenta A';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form.composer').requestSubmit();
    expect(send).toHaveBeenCalledOnce();
    appSurface(fixture).conversationSelection.set({
      kind: 'direct',
      accountId: 'a@example.invalid',
      jid: 'other@example.invalid',
    });
    facade.initialHistory.set({
      accountId: 'a@example.invalid',
      conversationId: 'other@example.invalid',
      generation: 2,
      status: 'ready',
    });
    fixture.detectChanges();
    const nextInput = fixture.nativeElement.querySelector(
      'textarea[name="message"]',
    ) as HTMLTextAreaElement;
    nextInput.value = 'cuenta B';
    nextInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    resolve(true);
    await Promise.resolve();
    fixture.detectChanges();
    expect(appSurface(fixture).draft()).toBe('cuenta B');
  });
  it('follows an incoming message, preserves old-message reading, and resumes at the end', async () => {
    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    let height = 1000;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 300 },
    });
    facade.messages.set([chatMessage('inicio', 'm1')]);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(700);
    height = 1050;
    facade.messages.set([...facade.messages(), chatMessage('😀 recibido', 'm2')]);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(750);
    area.scrollTop = 120;
    appSurface(fixture).onUserScrollIntent();
    await Promise.resolve();
    height = 1100;
    facade.messages.set([...facade.messages(), chatMessage('antiguo', 'm3')]);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(120);
    area.scrollTop = 800;
    appSurface(fixture).onUserScrollIntent();
    await Promise.resolve();
    height = 1150;
    facade.messages.set([...facade.messages(), chatMessage('vuelve', 'm4')]);
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
    facade.messages.set([chatMessage('uno', 'm1')]);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    height = 1050;
    facade.messages.set([...facade.messages(), chatMessage('dos', 'm2')]);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(750);
    height = 1100;
    facade.messages.set([...facade.messages(), chatMessage('tres', 'm3')]);
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
    facade.messages.set([chatMessage('último B', 'b1')]);
    fixture.detectChanges();
    appSurface(fixture).conversationSelection.set({
      kind: 'direct',
      accountId: 'a@example.invalid',
      jid: 'other@example.invalid',
    });
    facade.initialHistory.set({
      accountId: 'a@example.invalid',
      conversationId: 'other@example.invalid',
      generation: 2,
      status: 'ready',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(requestAnimationFrame);
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
    vi.mocked(facade.loadOlderMessages).mockImplementationOnce(async () => {
      height = 1200;
    });
    area.scrollTop = 0;
    appSurface(fixture).onChatScroll();
    await Promise.resolve();
    await new Promise(requestAnimationFrame);
    expect(area.scrollTop).toBe(200);
    expect(facade.loadOlderMessages).toHaveBeenCalledTimes(1);
  });
  it('anchors the first visible message when a capped older page keeps the same total height', async () => {
    const area = fixture.nativeElement.querySelector('.chat-content') as HTMLElement;
    Object.defineProperties(area, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ top: 0, bottom: 300, left: 0, right: 500, width: 500, height: 300 }),
      },
    });
    facade.messages.set([chatMessage('visible', 'm1'), chatMessage('latest', 'm2')]);
    fixture.detectChanges();
    await new Promise(requestAnimationFrame);

    const visible = area.querySelector<HTMLElement>('[data-timeline-id="text:m1"]');
    expect(visible).toBeTruthy();
    let anchorTop = 80;
    Object.defineProperty(visible!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: anchorTop,
        bottom: anchorTop + 50,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
      }),
    });

    let release!: () => void;
    vi.mocked(facade.loadOlderMessages).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    facade.hasOlderMessages.set(true);
    area.scrollTop = 0;
    appSurface(fixture).onChatScroll();
    appSurface(fixture).onChatScroll();
    expect(facade.loadOlderMessages).toHaveBeenCalledTimes(1);

    facade.messages.set([chatMessage('older', 'm0'), facade.messages()[0]]);
    anchorTop = 260;
    fixture.detectChanges();
    release();
    await Promise.resolve();
    await new Promise(requestAnimationFrame);

    expect(area.scrollHeight).toBe(1000);
    expect(area.scrollTop).toBe(180);
    expect(area.querySelector<HTMLElement>('[data-timeline-id="text:m1"]')).toBe(visible);
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
    appSurface(fixture).onChatScroll();
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
    const app = appSurface(fixture);
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
    const app = appSurface(fixture);
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
