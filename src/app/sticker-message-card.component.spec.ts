import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { StickerMessageCardComponent } from './sticker-message-card.component';
import { StickerMessageRef } from './core/domain';

const ref: StickerMessageRef = {
  refId: 'ref-1',
  previewStickerId: 'message:ref-1',
  accountId: 'alice@example.test',
  conversationId: 'bob@example.test',
  clientMessageId: 'client-1',
  direction: 'incoming',
  senderJid: 'bob@example.test',
  name: 'sticker.png',
  mimeType: 'image/png',
  sizeBytes: '4',
  width: 1,
  height: 1,
  hashAlgorithm: 'sha-256',
  hashValue: 'a'.repeat(64),
  transportStatus: 'sent',
  availability: 'missing',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const availableRef: StickerMessageRef = {
  ...ref,
  availability: 'available',
  localAssetId: 'asset-1',
};

describe('StickerMessageCardComponent', () => {
  let fixture: ComponentFixture<StickerMessageCardComponent>;

  afterEach(() => TestBed.resetTestingModule());

  it('keeps remote stickers manual and emits an explicit load request', () => {
    TestBed.configureTestingModule({ imports: [StickerMessageCardComponent] });
    fixture = TestBed.createComponent(StickerMessageCardComponent);
    fixture.componentRef.setInput('accountId', ref.accountId);
    fixture.componentRef.setInput('sticker', ref);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toContain('Cargar sticker');
    const requests: string[] = [];
    fixture.componentInstance.loadRequested.subscribe((value) => requests.push(value));
    button.click();
    expect(requests).toEqual(['ref-1']);
  });

  it('guards the save action, resets on a new result, and derives the saved state from the reference', () => {
    TestBed.configureTestingModule({ imports: [StickerMessageCardComponent] });
    fixture = TestBed.createComponent(StickerMessageCardComponent);
    fixture.componentRef.setInput('accountId', availableRef.accountId);
    fixture.componentRef.setInput('sticker', availableRef);
    fixture.detectChanges();
    const requests: string[] = [];
    fixture.componentInstance.saveRequested.subscribe((value) => requests.push(value));
    const button = fixture.nativeElement.querySelector('.sticker-save') as HTMLButtonElement;
    button.click();
    button.click();
    expect(requests).toEqual(['ref-1']);
    expect(fixture.componentInstance.saving()).toBe(true);
    fixture.componentRef.setInput('sticker', { ...availableRef, errorCode: 'STORAGE_FAILED' });
    fixture.detectChanges();
    expect(fixture.componentInstance.saving()).toBe(false);
    expect((fixture.nativeElement.querySelector('.sticker-save') as HTMLButtonElement).textContent).toContain('Reintentar');
    fixture.componentRef.setInput('sticker', { ...availableRef, savedStickerId: 'saved-1' });
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.sticker-save') as HTMLButtonElement).textContent).toContain('Ya está guardado');
  });
});
