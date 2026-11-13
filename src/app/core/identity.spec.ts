import { describe, expect, it } from 'vitest';
import { bareJid, normalizedAccountId, normalizedBareJid } from './identity';

describe('identity normalization', () => {
  it('removes resources and normalizes case without changing historical bareJid semantics', () => {
    expect(bareJid('Alice@Example.Invalid/Desktop')).toBe('alice@example.invalid');
    expect(bareJid(' Alice@Example.Invalid/Desktop ')).toBe(' alice@example.invalid');
  });

  it('provides the trimmed variant for identity stores', () => {
    expect(normalizedBareJid(' Alice@Example.Invalid/Desktop ')).toBe('alice@example.invalid');
  });

  it('normalizes account identifiers independently from JID resources', () => {
    expect(normalizedAccountId(' Operator@Example.Invalid ')).toBe('operator@example.invalid');
  });
});
