import { describe, expect, it } from 'vitest';
import { stickerSendErrorMessage } from './app';

describe('sticker send error presentation', () => {
  it('preserves safe, specific messages for typed transport errors', () => {
    expect(stickerSendErrorMessage({ code: 'UNSUPPORTED', message: 'secret-url-token' })).toContain('XEP-0363');
    expect(stickerSendErrorMessage({ code: 'MEDIA_SIZE_EXCEEDED', message: 'secret-url-token' })).toContain('tamaño');
    expect(stickerSendErrorMessage({ code: 'TRANSPORT_FAILED', message: 'secret-url-token' })).toContain('HTTP Upload');
    expect(stickerSendErrorMessage({ code: 'TIMEOUT', message: 'secret-url-token' })).toContain('tiempo');
    expect(stickerSendErrorMessage({ code: 'SEND_RESULT_UNKNOWN', message: 'secret-url-token' })).toContain('no confirmó');
    expect(stickerSendErrorMessage({ code: 'CONFLICT', message: 'secret-url-token' })).toContain('conflicto');
    expect(stickerSendErrorMessage({ code: 'INTERNAL', message: 'secret-url-token' })).not.toContain('secret-url-token');
  });
});
