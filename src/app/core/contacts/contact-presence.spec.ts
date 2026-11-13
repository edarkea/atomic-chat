import { describe, expect, it } from 'vitest';
import type { Contact, Presence } from '../domain';
import { applyRemoteContactPresence, resetRosterContactPresence } from './contact-presence';

const now = '2026-01-01T00:00:00.000Z';

function contact(jid: string, options: Partial<Contact> = {}): Contact {
  return { jid, name: jid, groups: [], source: 'roster', ...options };
}

function presence(jid: string, availability: Presence['availability'] = 'available'): Presence {
  return { jid, availability, updatedAt: now };
}

describe('contact presence projection', () => {
  it('updates exactly matching authorized contacts without changing unrelated references', () => {
    const old = contact('friend@example.invalid', {
      subscription: 'both',
      presence: presence('friend@example.invalid', 'unknown'),
    });
    const other = contact('other@example.invalid', { subscription: 'both' });
    const nextPresence = presence('friend@example.invalid');
    const result = applyRemoteContactPresence([old, other], nextPresence);

    expect(result[0]).toEqual({ ...old, presence: nextPresence });
    expect(result[0]).not.toBe(old);
    expect(result[0].presence).toBe(nextPresence);
    expect(result[1]).toBe(other);
  });

  it('requires subscription to or both; ignores from, none and missing subscriptions', () => {
    const subscriptions: Array<Contact['subscription']> = ['to', 'both', 'from', 'none', undefined];
    const contacts = subscriptions.map((subscription) =>
      contact('same@example.invalid', { subscription }),
    );
    const result = applyRemoteContactPresence(contacts, presence('same@example.invalid'));

    expect(result.slice(0, 2).map((item) => item.presence?.availability)).toEqual([
      'available',
      'available',
    ]);
    expect(result.slice(2)).toEqual(contacts.slice(2));
    expect(result.slice(2).every((item, index) => item === contacts[index + 2])).toBe(true);
  });

  it('preserves exact JID matching for resource or case variants at event receipt', () => {
    const original = [
      contact('friend@example.invalid', { subscription: 'both' }),
      contact('Friend@example.invalid', { subscription: 'both' }),
    ];
    const result = applyRemoteContactPresence(original, presence('friend@example.invalid/phone'));

    expect(result).toEqual(original);
    expect(result[0]).toBe(original[0]);
    expect(result[1]).toBe(original[1]);
  });

  it('does not modify the input list or its contact objects', () => {
    const original = [contact('friend@example.invalid', { subscription: 'to' })];
    const incoming = presence('friend@example.invalid');
    const result = applyRemoteContactPresence(original, incoming);

    expect(original[0].presence).toBeUndefined();
    expect(result).not.toBe(original);
    expect(result[0]).not.toBe(original[0]);
    expect(incoming).toEqual(presence('friend@example.invalid'));
  });

  it('resets roster presence using one timestamp and preserves local conversation contacts', () => {
    const roster = contact('friend@example.invalid', {
      presence: presence('friend@example.invalid'),
    });
    const local = contact('local@example.invalid', {
      source: 'conversation',
      presence: presence('local@example.invalid'),
    });
    const result = resetRosterContactPresence([roster, local], '2026-01-02T03:04:05.000Z');

    expect(result[0].presence).toEqual({
      jid: 'friend@example.invalid',
      availability: 'unknown',
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
    expect(result[1]).toBe(local);
    expect(roster.presence?.availability).toBe('available');
    expect(local.presence?.availability).toBe('available');
  });

  it('preserves roster order and resets presence even when it was already unknown', () => {
    const previous = [
      contact('a@example.invalid', { presence: presence('a@example.invalid', 'unknown') }),
      contact('b@example.invalid'),
      contact('c@example.invalid', { source: 'conversation' }),
    ];
    const result = resetRosterContactPresence(previous, now);

    expect(result.map((item) => item.jid)).toEqual(previous.map((item) => item.jid));
    expect(result[0].presence?.updatedAt).toBe(now);
    expect(result[1].presence?.availability).toBe('unknown');
    expect(result[2]).toBe(previous[2]);
    expect(result).not.toBe(previous);
  });
});
