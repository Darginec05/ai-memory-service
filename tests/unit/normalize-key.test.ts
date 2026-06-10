import { describe, expect, it } from 'vitest';
import { normalizeKey } from '../../src/services/extraction/candidate-extractor';

describe('normalizeKey', () => {
  it('lowercases and converts whitespace runs to dots', () => {
    expect(normalizeKey('Location City')).toBe('location.city');
    expect(normalizeKey('health   knee issue')).toBe('health.knee.issue');
  });

  it('trims before normalizing so edges never become dots', () => {
    expect(normalizeKey('  job  ')).toBe('job');
  });

  it('falls back to "other" for empty or whitespace-only keys', () => {
    expect(normalizeKey('')).toBe('other');
    expect(normalizeKey('   ')).toBe('other');
  });

  it('caps the key length at 64 chars', () => {
    expect(normalizeKey('k'.repeat(100))).toHaveLength(64);
  });
});
