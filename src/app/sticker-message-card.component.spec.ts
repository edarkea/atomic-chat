import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
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

describe('StickerMessageCardComponent', () => {
  let fixture: ComponentFixture<StickerMessageCardComponent>;

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
});
