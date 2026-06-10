import { pg } from '../../db/client';
import { openAiGateway, type LlmGateway } from '../../lib/openai';
import { FtsSearcher } from './fts-searcher';
import { rrfFuse } from './fusion';
import { VectorSearcher } from './vector-searcher';
import type { RetrievalScope, RetrievedItem, ScoredItem } from './types';

export type { RetrievalScope, RetrievedItem, RetrievedMemory, RetrievedMessage, ScoredItem } from './types';
export { scopeFromRequest } from './scope';

const CANDIDATES_PER_BRANCH = 30;

export class RetrievalService {
  constructor(
    private readonly vectorSearcher: VectorSearcher,
    private readonly ftsSearcher: FtsSearcher,
    private readonly llm: LlmGateway,
  ) {}

  async search(scope: RetrievalScope, query: string, limit: number): Promise<ScoredItem[]> {
    const startedAt = Date.now();
    const queryEmbedding = await this.embedQuery(query);

    const branches: Array<Promise<RetrievedItem[]>> = [
      this.ftsSearcher.searchMemories(scope, query, CANDIDATES_PER_BRANCH),
      this.ftsSearcher.searchMessages(scope, query, CANDIDATES_PER_BRANCH),
    ];

    if (queryEmbedding) {
      branches.push(this.vectorSearcher.searchMemories(scope, queryEmbedding, CANDIDATES_PER_BRANCH));
      branches.push(this.vectorSearcher.searchMessages(scope, queryEmbedding, CANDIDATES_PER_BRANCH));
    }

    const rankings = await Promise.all(branches);
    const fused = rrfFuse(rankings).slice(0, limit);

    // RRF scores live on an opaque scale (~1/61 per list hit); normalize so the
    // contract's "score" reads as relative relevance within this result set.
    const maxScore = fused[0]?.score;
    const results = maxScore
      ? fused.map((scored) => ({ item: scored.item, score: scored.score / maxScore }))
      : fused;

    console.log(
      `[retrieval] scope=${scope.kind} branches=${rankings.length} fused=${results.length} embedded=${queryEmbedding !== null} took=${Date.now() - startedAt}ms`,
    );
    return results;
  }

  // Embedding failure degrades to FTS-only search instead of a 5xx: exact-token
  // matching still answers many queries, and /recall must never error.
  private async embedQuery(query: string): Promise<number[] | null> {
    try {
      const embeddings = await this.llm.embedTexts([query]);
      return embeddings[0] ?? null;
    } catch (err) {
      console.warn('[retrieval] query embedding failed, falling back to FTS only:', err);
      return null;
    }
  }
}

export const retrievalService = new RetrievalService(
  new VectorSearcher(pg),
  new FtsSearcher(pg),
  openAiGateway,
);
