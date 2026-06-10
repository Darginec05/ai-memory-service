import { describe, expect, it } from 'vitest';
import { normalizeScores, rrfFuse } from '../../src/services/retrieval/fusion';
import { memoryItem, messageItem } from './fakes';

describe('rrfFuse', () => {
  it('returns empty for no rankings', () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([[], []])).toEqual([]);
  });

  it('preserves the order of a single ranking', () => {
    const a = memoryItem();
    const b = memoryItem();
    const fused = rrfFuse([[a, b]]);
    expect(fused.map(({ item }) => item.id)).toEqual([a.id, b.id]);
    expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
  });

  it('ranks cross-branch agreement above a single top hit', () => {
    const onlyTopOfOne = memoryItem();
    const inBothLists = memoryItem();
    // 2 × 1/(60+2) = 0.0323 beats 1 × 1/(60+1) = 0.0164
    const fused = rrfFuse([
      [onlyTopOfOne, inBothLists],
      [inBothLists],
    ]);
    expect(fused[0]!.item.id).toBe(inBothLists.id);
  });

  it('accumulates reciprocal-rank scores per item', () => {
    const item = memoryItem();
    const fused = rrfFuse([[item], [item]]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.score).toBeCloseTo(2 / 61, 10);
  });

  it('does not collapse a memory and a message sharing the same raw id', () => {
    const memory = memoryItem({ id: 'same-id' });
    const message = messageItem({ id: 'same-id' });
    expect(rrfFuse([[memory], [message]])).toHaveLength(2);
  });
});

describe('normalizeScores', () => {
  it('rescales so the top item reads 1.0 and the rest stay relative', () => {
    const scored = [
      { item: memoryItem(), score: 0.05 },
      { item: memoryItem(), score: 0.025 },
    ];
    const normalized = normalizeScores(scored);
    expect(normalized[0]!.score).toBe(1);
    expect(normalized[1]!.score).toBeCloseTo(0.5, 10);
  });

  it('passes through empty and zero-score inputs', () => {
    expect(normalizeScores([])).toEqual([]);
    const zero = [{ item: memoryItem(), score: 0 }];
    expect(normalizeScores(zero)).toBe(zero);
  });
});
