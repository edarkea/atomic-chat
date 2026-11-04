import { formatMessageDate, formatMessageDateTime, formatMessageTime, messageDayKey } from './message-date-time';

describe('message date/time formatting', () => {
  it('uses the system locale for valid historical timestamps', () => {
    expect(formatMessageTime('2024-01-02T15:04:00.000Z')).not.toBe('—:—');
    expect(formatMessageDateTime('2024-01-02T15:04:00.000Z')).not.toBe('Fecha no disponible');
    expect(formatMessageDate('2024-01-02T15:04:00.000Z')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('handles missing or invalid timestamps without throwing', () => {
    expect(formatMessageTime(undefined)).toBe('—:—');
    expect(formatMessageDateTime('not-a-date')).toBe('Fecha no disponible');
    expect(formatMessageDate('not-a-date')).toBe('--/--/----');
    expect(messageDayKey('not-a-date')).toBe('invalid');
  });
});
