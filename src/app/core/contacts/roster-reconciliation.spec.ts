import { describe, expect, it, vi } from 'vitest';
import type { Contact, Presence } from '../domain';
import { reconcileRosterContacts } from './roster-reconciliation';

const fixedTime = '2026-01-01T00:00:00.000Z';
const now = () => fixedTime;

function contact(jid: string, overrides: Partial<Contact> = {}): Contact {
  return { jid, name: jid, groups: [], ...overrides };
}

function online(jid: string): Presence {
  return { jid, availability: 'available', updatedAt: fixedTime };
}

describe('reconcileRosterContacts', () => {
  it('normalizes resource and case variants, with last payload winning at the first position', () => {
    const roster = [
      contact('A@example.invalid/desktop', { name: 'A initial' }),
      contact('b@example.invalid/phone', { name: 'B' }),
      contact('a@example.invalid/mobile', { name: 'A final' }),
    ];
    const result = reconcileRosterContacts([], roster, now);

    expect(result.map((item) => item.jid)).toEqual(['a@example.invalid', 'b@example.invalid']);
    expect(result.map((item) => item.name)).toEqual(['A final', 'B']);
    expect(result.every((item) => item.source === 'roster')).toBe(true);
    expect(result[0].presence).toEqual({
      jid: 'a@example.invalid',
      availability: 'unknown',
      updatedAt: fixedTime,
    });
  });

  it('preserves known presence only for newly authorized to/both subscriptions', () => {
    const previous = ['to', 'both', 'from', 'none', 'missing'].map((name) =>
      contact(`${name}@example.invalid`, {
        source: 'roster',
        presence: online(`${name}@example.invalid`),
      }),
    );
    const roster = [
      contact('to@example.invalid', { subscription: 'to' }),
      contact('both@example.invalid', { subscription: 'both' }),
      contact('from@example.invalid', { subscription: 'from' }),
      contact('none@example.invalid', { subscription: 'none' }),
      contact('missing@example.invalid'),
    ];
    const result = reconcileRosterContacts(previous, roster, now);

    expect(result[0].presence).toBe(previous[0].presence);
    expect(result[1].presence).toBe(previous[1].presence);
    expect(result.slice(2).map((item) => item.presence?.availability)).toEqual([
      'unknown',
      'unknown',
      'unknown',
    ]);
  });

  it('keeps only local conversations missing from the roster and drops removed remote contacts', () => {
    const previous = [
      contact('removed@example.invalid', { source: 'roster' }),
      contact('local@example.invalid/device', { source: 'conversation', groups: ['manual'] }),
      contact('replaced@example.invalid/mobile', { source: 'conversation', name: 'Local name' }),
    ];
    const roster = [contact('replaced@example.invalid/desktop', { name: 'Roster name' })];
    const result = reconcileRosterContacts(previous, roster, now);

    expect(result.map((item) => item.jid)).toEqual([
      'replaced@example.invalid',
      'local@example.invalid/device',
    ]);
    expect(result.map((item) => item.name)).toEqual([
      'Roster name',
      'local@example.invalid/device',
    ]);
    expect(result[1]).toBe(previous[1]);
  });

  it('preserves the original contact arrays, objects and presence references', () => {
    const presence = online('a@example.invalid');
    const previous = [contact('a@example.invalid', { source: 'roster', presence })];
    const roster = [contact('A@example.invalid/phone', { subscription: 'both', groups: ['team'] })];
    const before = structuredClone({ previous, roster });
    const result = reconcileRosterContacts(previous, roster, now);

    expect({ previous, roster }).toEqual(before);
    expect(result).not.toBe(previous);
    expect(result[0]).not.toBe(roster[0]);
    expect(result[0].presence).toBe(presence);
  });

  it('calls the timestamp provider only when new unknown presence is needed', () => {
    const clock = vi.fn(() => fixedTime);
    const previous = [
      contact('known@example.invalid', { presence: online('known@example.invalid') }),
    ];
    const roster = [
      contact('known@example.invalid', { subscription: 'both' }),
      contact('new@example.invalid', { subscription: 'to' }),
      contact('hidden@example.invalid', { subscription: 'from' }),
    ];
    const result = reconcileRosterContacts(previous, roster, clock);

    expect(clock).toHaveBeenCalledTimes(2);
    expect(result[0].presence).toBe(previous[0].presence);
    expect(result[1].presence?.updatedAt).toBe(fixedTime);
    expect(result[2].presence?.updatedAt).toBe(fixedTime);
  });

  it('preserves ordering and leaves conversation-only contacts untouched when roster is empty', () => {
    const local = contact('Friend@example.invalid/mobile', {
      name: 'Local conversation',
      groups: ['local'],
      source: 'conversation',
    });
    const result = reconcileRosterContacts(
      [contact('remote@example.invalid', { source: 'roster' }), local],
      [],
      now,
    );

    expect(result).toEqual([local]);
    expect(result[0]).toBe(local);
  });
});
