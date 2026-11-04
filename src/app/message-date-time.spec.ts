import { formatMessageDateTime, formatMessageTime, messageDayKey } from './message-date-time';

describe('message date/time formatting', () => {
  it('uses the system locale for valid historical timestamps', () => {
    expect(formatMessageTime('2024-01-02T15:04:00.000Z')).not.toBe('—:—');
    expect(formatMessageDateTime('2024-01-02T15:04:00.000Z')).not.toBe('Fecha no disponible');
  });

  it('handles missing or invalid timestamps without throwing', () => {
    expect(formatMessageTime(undefined)).toBe('—:—');
    expect(formatMessageDateTime('not-a-date')).toBe('Fecha no disponible');
    expect(messageDayKey('not-a-date')).toBe('invalid');
  });
});
