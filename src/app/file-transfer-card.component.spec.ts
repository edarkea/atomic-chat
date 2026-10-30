import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileTransfer,
  ImagePreviewRef,
  PreviewStreamRef,
  Result,
} from './core/domain';
import { PREVIEW_PORT, PreviewPort } from './core/ports';
import { FileTransferCardComponent } from './file-transfer-card.component';

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

describe('FileTransferCardComponent preview lifecycle', () => {
  let fixture: ComponentFixture<FileTransferCardComponent>;
  let get: ReturnType<typeof vi.fn<PreviewPort['get']>>;
  let open: ReturnType<typeof vi.fn<PreviewPort['open']>>;
  let read: ReturnType<typeof vi.fn<PreviewPort['read']>>;
  let close: ReturnType<typeof vi.fn<PreviewPort['close']>>;
  let revoke: ReturnType<typeof vi.fn<PreviewPort['revoke']>>;

  beforeEach(async () => {
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
  });

  it('does not loop or duplicate the load when the completed transfer is unchanged', async () => {
    const completed = transfer();
    fixture.componentRef.setInput('transfer', completed);
    fixture.detectChanges();
    await fixture.whenStable();
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
    await Promise.resolve();
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
});
