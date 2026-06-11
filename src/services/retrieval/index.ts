import { pg } from '../../db/client';
import { createLogger } from '../../lib/logger';
import { openAiGateway, type LlmGateway } from '../../lib/openai';
import { FtsSearcher } from './fts-searcher';
import { normalizeScores, rrfFuse } from './fusion';
import { DEFAULT_MAX_DISTANCE, VectorSearcher } from './vector-searcher';
import type { RetrievalScope, RetrievedItem, ScoredItem } from './types';

export type { RetrievalScope, RetrievedItem, RetrievedMemory, RetrievedMessage, ScoredItem } from './types';
export { scopeFromRequest } from './scope';
export { normalizeScores, rrfFuse } from './fusion';
export { DEFAULT_MAX_DISTANCE } from './vector-searcher';

const log = createLogger('retrieval');

const CANDIDATES_PER_BRANCH = 30;

export class RetrievalService {
  constructor(
    private readonly vectorSearcher: VectorSearcher,
    private readonly ftsSearcher: FtsSearcher,
    private readonly llm: LlmGateway,
  ) {}

  async search(
    scope: RetrievalScope,
    query: string,
    limit: number,
    maxDistance: number = DEFAULT_MAX_DISTANCE,
  ): Promise<ScoredItem[]> {
    const [results] = await this.searchMany(scope, [query], limit, maxDistance);
    return results ?? [];
  }

  // One ranking per query: callers fanning out over query variants (the /recall
  // rewriter) get all embeddings from a single embeddings API call instead of
  // one HTTP roundtrip per variant.
  async searchMany(
    scope: RetrievalScope,
    queries: string[],
    limit: number,
    maxDistance: number = DEFAULT_MAX_DISTANCE,
  ): Promise<ScoredItem[][]> {
    const startedAt = Date.now();
    const embeddings = await this.embedQueries(queries);

    const perQuery = await Promise.all(
      queries.map((query, i) =>
        this.searchOne(scope, query, embeddings[i] ?? null, limit, maxDistance),
      ),
    );

    const embedded = embeddings.some((e) => e !== null);
    log.info(
      `scope=${scope.kind} queries=${queries.length} fused=${perQuery.map((r) => r.length).join('/')} embedded=${embedded} took=${Date.now() - startedAt}ms`,
    );
    return perQuery;
  }

  private async searchOne(
    scope: RetrievalScope,
    query: string,
    queryEmbedding: number[] | null,
    limit: number,
    maxDistance: number,
  ): Promise<ScoredItem[]> {
    const branches: Array<Promise<RetrievedItem[]>> = [
      this.ftsSearcher.searchMemories(scope, query, CANDIDATES_PER_BRANCH),
      this.ftsSearcher.searchMessages(scope, query, CANDIDATES_PER_BRANCH),
    ];

    if (queryEmbedding) {
      branches.push(
        this.vectorSearcher.searchMemories(scope, queryEmbedding, CANDIDATES_PER_BRANCH, maxDistance),
      );
      branches.push(
        this.vectorSearcher.searchMessages(scope, queryEmbedding, CANDIDATES_PER_BRANCH, maxDistance),
      );
    }

    const rankings = await Promise.all(branches);
    log.debug('branch rankings:', rankings);
    const fused = rrfFuse(rankings).slice(0, limit);
    log.debug('fused:', fused);

    return normalizeScores(fused);
  }

  // Embedding failure degrades to FTS-only search instead of a 5xx: exact-token
  // matching still answers many queries, and /recall must never error.
  private async embedQueries(queries: string[]): Promise<Array<number[] | null>> {
    try {
      const embeddings = await this.llm.embedTexts(queries);
      return queries.map((_, i) => embeddings[i] ?? null);
    } catch (err) {
      log.warn('query embedding failed, falling back to FTS only:', err);
      return queries.map(() => null);
    }
  }
}

export const retrievalService = new RetrievalService(
  new VectorSearcher(pg),
  new FtsSearcher(pg),
  openAiGateway,
);
