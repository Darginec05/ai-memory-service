import { itemKey, type RetrievedItem, type ScoredItem } from './types';

// Standard RRF constant (Cormack et al.): dampens the gap between top ranks so
// one branch's #1 can't drown out consistent mid-rank agreement from others.
const RRF_K = 60;

// Reciprocal rank fusion: rank-based, so cosine distance and ts_rank never need
// to be calibrated against each other. Items found by several branches rise.
export function rrfFuse(rankings: ReadonlyArray<ReadonlyArray<RetrievedItem>>): ScoredItem[] {
  const fused = new Map<string, ScoredItem>();

  for (const ranking of rankings) {
    ranking.forEach((item, rank) => {
      const key = itemKey(item);
      const increment = 1 / (RRF_K + rank + 1);
      const existing = fused.get(key);
      if (existing) {
        existing.score += increment;
      } else {
        fused.set(key, { item, score: increment });
      }
    });
  }

  return [...fused.values()].sort((a, b) => b.score - a.score);
}
