import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatFileHistoryRecord,
  FileTransfer,
  ImagePreviewRef,
  PreviewStreamRef,
  Result,
} from './core/domain';
import { PREVIEW_PORT, PreviewPort } from './core/ports';
import { FileTransferCardComponent } from './file-transfer-card.component';

class VisibleIntersectionObserver implements IntersectionObserver {
  static instance: VisibleIntersectionObserver | undefined;
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number> = [0];
  constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '0px';
    VisibleIntersectionObserver.instance = this;
  }
  observe(target: Element): void {
    const entry = { target, isIntersecting: true, boundingClientRect: { top: 10, bottom: 100 } } as IntersectionObserverEntry;
    this.callback([entry], this);
  }
  emit(target: Element, isIntersecting: boolean): void {
    const entry = { target, isIntersecting, boundingClientRect: { top: -400, bottom: -300 } } as IntersectionObserverEntry;
    this.callback([entry], this);
  }
  unobserve(_target: Element): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

const transfer = (state: FileTransfer['state'] = 'completed'): FileTransfer => ({
  offer: {
    transferId: 'transfer-preview',
    accountId: 'account@example.invalid',
    conversationId: 'contact@example.invalid',
    senderJid: 'contact@example.invalid',
    name: 'image.jpg',
    sizeBytes: '17',
    transport: 'ibb',
    offeredAt: '2026-01-01T00:00:00.000Z',
  },
  direction: 'incoming',
  state,
  bytesTransferred: state === 'completed' ? '17' : '0',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const unavailable = (): Result<ImagePreviewRef> => ({
  ok: true,
  version: 1,
  requestId: 'preview-get',
  value: {
    state: 'unsupported',
    accountId: 'account@example.invalid',
    transferId: 'transfer-preview',
    reasonCode: 'MEDIA_TYPE_UNSUPPORTED',
  },
});

const documentTransfer = (direction: FileTransfer['direction'] = 'incoming'): FileTransfer => ({
  ...transfer(),
  direction,
  offer: {
    ...transfer().offer,
    name: 'report.pdf',
    mimeType: 'application/pdf',
  },
  localActions: { open: true, reveal: true },
});

const historicalFile = (availability: ChatFileHistoryRecord['availability']): ChatFileHistoryRecord => ({
  fileId: 'file-history-1',
  accountId: 'account@example.invalid',
  conversationId: 'contact@example.invalid',
  transferId: 'transfer-history',
  direction: 'incoming',
  senderJid: 'contact@example.invalid',
  originalName: 'report.pdf',
  sizeBytes: '132020',
  createdAt: '2026-01-01T00:00:00.000Z',
  availability,
});

afterEach(() => {
  vi.unstubAllGlobals();
  VisibleIntersectionObserver.instance = undefined;
});

describe('FileTransferCardComponent preview lifecycle', () => {
  let fixture: ComponentFixture<FileTransferCardComponent>;
  let get: ReturnType<typeof vi.fn<PreviewPort['get']>>;
  let open: ReturnType<typeof vi.fn<PreviewPort['open']>>;
  let read: ReturnType<typeof vi.fn<PreviewPort['read']>>;
  let close: ReturnType<typeof vi.fn<PreviewPort['close']>>;
  let revoke: ReturnType<typeof vi.fn<PreviewPort['revoke']>>;

  beforeEach(async () => {
    vi.stubGlobal('IntersectionObserver', VisibleIntersectionObserver);
    get = vi.fn<PreviewPort['get']>(async () => unavailable());
    open = vi.fn<PreviewPort['open']>(async () => {
      throw new Error('open no preparado');
    });
    read = vi.fn<PreviewPort['read']>(async () => {
      throw new Error('read no preparado');
    });
    close = vi.fn<PreviewPort['close']>(async () => ({
      ok: true,
      version: 1,
      requestId: 'close',
      value: undefined,
    }));
    revoke = vi.fn<PreviewPort['revoke']>(async () => ({
      ok: true,
      version: 1,
      requestId: 'revoke',
      value: undefined,
    }));
    const port: PreviewPort = { get, open, read, close, revoke };
    await TestBed.configureTestingModule({
      imports: [FileTransferCardComponent],
      providers: [{ provide: PREVIEW_PORT, useValue: port }],
    }).compileComponents();
    fixture = TestBed.createComponent(FileTransferCardComponent);
    fixture.componentRef.setInput('label', 'Archivo recibido correctamente');
    const root = document.createElement('div');
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 500 } as DOMRect);
    fixture.componentRef.setInput('previewRoot', root);
  });

  it('does not loop or duplicate the load when the completed transfer is unchanged', async () => {
    const completed = transfer();
    fixture.componentRef.setInput('transfer', completed);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    fixture.componentRef.setInput('transfer', { ...completed });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(get).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.textContent).toContain('solo PNG/JPEG');
  });

  it('cancels pending open and revokes the grant when the component is destroyed', async () => {
    let resolveOpen!: (value: Result<PreviewStreamRef>) => void;
    const ready: ImagePreviewRef = {
      state: 'ready',
      previewId: 'preview-1',
      accountId: 'account@example.invalid',
      transferId: 'transfer-preview',
      mimeType: 'image/jpeg',
      sizeBytes: '17',
      width: 2,
      height: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    get.mockResolvedValueOnce({ ok: true, version: 1, requestId: 'get', value: ready });
    open.mockImplementationOnce(
      () =>
        new Promise<Result<PreviewStreamRef>>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    fixture.componentRef.setInput('transfer', transfer());
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(open).toHaveBeenCalledOnce();
    fixture.destroy();
    resolveOpen({
      ok: true,
      version: 1,
      requestId: 'open',
      value: { previewId: 'preview-1', streamId: 'stream-1', expiresAt: ready.expiresAt, chunkSize: 65_536 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(read).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('closes and revokes a completed read, then frees its URL outside the active region', async () => {
    const createObjectURL = vi.fn(() => 'blob:preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const ready: ImagePreviewRef = {
      state: 'ready',
      previewId: 'preview-1',
      accountId: 'account@example.invalid',
      transferId: 'transfer-preview',
      mimeType: 'image/jpeg',
      sizeBytes: '17',
      width: 2,
      height: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    get.mockResolvedValueOnce({ ok: true, version: 1, requestId: 'get', value: ready });
    open.mockResolvedValueOnce({
      ok: true,
      version: 1,
      requestId: 'open',
      value: { previewId: 'preview-1', streamId: 'stream-1', expiresAt: ready.expiresAt, chunkSize: 65_536 },
    });
    read.mockResolvedValueOnce({
      ok: true,
      version: 1,
      requestId: 'read',
      value: { previewId: 'preview-1', streamId: 'stream-1', sequence: 0, bytes: new ArrayBuffer(4), done: true },
    });
    fixture.componentRef.setInput('transfer', transfer());
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();

    expect(read).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:preview');

    const target = fixture.nativeElement.querySelector('article') as Element;
    VisibleIntersectionObserver.instance?.emit(target, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview');

    VisibleIntersectionObserver.instance?.emit(target, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('opens an available historical file from its compact heading', async () => {
    let openedId = '';
    fixture.componentInstance.historicalOpened.subscribe((value) => (openedId = value));
    fixture.componentRef.setInput('transfer', documentTransfer());
    fixture.componentRef.setInput('history', historicalFile('available'));
    fixture.componentRef.setInput('label', 'Archivo histórico disponible');
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = fixture.nativeElement.querySelector('.file-heading') as HTMLButtonElement;
    expect(heading.disabled).toBe(false);
    expect(heading.getAttribute('aria-label')).toBe('Abrir archivo report.pdf');
    heading.click();
    expect(openedId).toBe('file-history-1');
    expect(fixture.nativeElement.querySelectorAll('.file-action-icon')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).not.toContain('Abrir archivo');
    expect(fixture.nativeElement.textContent).not.toContain('Archivo histórico disponible');
  });

  it('opens a completed received file from its compact heading', async () => {
    let openedId = '';
    fixture.componentInstance.opened.subscribe((value) => (openedId = value));
    fixture.componentRef.setInput('transfer', documentTransfer());
    fixture.componentRef.setInput('label', 'Archivo recibido correctamente');
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = fixture.nativeElement.querySelector('.file-heading') as HTMLButtonElement;
    heading.click();
    expect(openedId).toBe('transfer-preview');
    expect(fixture.nativeElement.querySelectorAll('.file-action-icon')).toHaveLength(0);
  });

  it('opens a completed sent file from its compact heading', async () => {
    let openedId = '';
    fixture.componentInstance.opened.subscribe((value) => (openedId = value));
    fixture.componentRef.setInput('transfer', documentTransfer('outgoing'));
    fixture.componentRef.setInput('label', 'Archivo enviado');
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = fixture.nativeElement.querySelector('.file-heading') as HTMLButtonElement;
    expect(heading.disabled).toBe(false);
    heading.click();
    expect(openedId).toBe('transfer-preview');
  });

  it('shows a friendly unavailable state without exposing internal messages', async () => {
    fixture.componentRef.setInput('transfer', documentTransfer());
    fixture.componentRef.setInput('history', historicalFile('changed'));
    fixture.componentRef.setInput('label', 'La ventana, cuenta o transferencia no están autorizadas.');
    fixture.detectChanges();
    await fixture.whenStable();

    const heading = fixture.nativeElement.querySelector('.file-heading') as HTMLButtonElement;
    expect(heading.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Archivo no disponible');
    expect(fixture.nativeElement.textContent).not.toContain('La ventana, cuenta o transferencia');
    expect(fixture.nativeElement.textContent).not.toContain('Abrir carpeta');
  });

  it('keeps image preview content free of MIME and byte metadata', async () => {
    fixture.componentRef.setInput('transfer', {
      ...transfer(),
      offer: { ...transfer().offer, mimeType: 'image/png' },
    });
    fixture.componentRef.setInput('label', 'Archivo recibido correctamente');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.image-meta')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('image/png');
    expect(fixture.nativeElement.textContent).not.toContain('17 bytes');
  });
});
