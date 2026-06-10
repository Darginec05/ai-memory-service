import { describe, expect, it } from 'vitest';
import { dedupeQueries } from '../../src/services/recall';

describe('dedupeQueries', () => {
  it('keeps the original query first and dedupes case-insensitively', () => {
    expect(
      dedupeQueries(['Where do I live?', 'user current city', ' where do i live? ']),
    ).toEqual(['Where do I live?', 'user current city']);
  });

  it('trims entries and drops empty or whitespace-only ones', () => {
    expect(dedupeQueries(['  a  ', '', '   ', 'b'])).toEqual(['a', 'b']);
  });

  it('caps the variants at 4 (original + 3 rewrites)', () => {
    expect(dedupeQueries(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd']);
  });
});
