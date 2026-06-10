import { pg } from '../../db/client';
import { createLogger } from '../../lib/logger';
import { openAiGateway } from '../../lib/openai';
import {
  normalizeScores,
  retrievalService,
  rrfFuse,
  RetrievalService,
  type RetrievalScope,
  type ScoredItem,
} from '../retrieval';
import { ContextAssembler } from './context-assembler';
import { QueryRewriter } from './query-rewriter';
import { Reranker } from './reranker';
import type { AssembledRecall } from './types';

export type { AssembledRecall, Citation } from './types';

const log = createLogger('recall');

const RECALL_CANDIDATES = 24;
const MAX_QUERY_VARIANTS = 4;
// Looser than the 0.6 default: /recall has a precision stage (rerank) after
// retrieval, so the first stage trades precision for recall. Calibrated on the
// fixture corpus: obliquely-relevant facts ("opening their own bakery" vs
// "what's their job") measure 0.63-0.71, while the noise floor (nearest fully
// irrelevant memory across noise probes) starts at ~0.746 — 0.73 sits inside
// that gap. /search stays at 0.6 — it has no rerank to clean up a looser net.
const RECALL_MAX_DISTANCE = 0.73;

// /recall pipeline: LLM query rewriting (recall: find what raw queries miss)
// -> hybrid retrieval per variant -> RRF across variants -> LLM rerank
// (precision: drop noise and fact-covered snippets) -> budgeted assembly.
export class RecallService {
  constructor(
    private readonly queryRewriter: QueryRewriter,
    private readonly retrieval: RetrievalService,
    private readonly reranker: Reranker,
    private readonly assembler: ContextAssembler,
  ) {}

  async recall(scope: RetrievalScope, query: string, maxTokens: number): Promise<AssembledRecall> {
    const startedAt = Date.now();

    const rewrites = await this.queryRewriter.rewrite(query);
    const queries = dedupeQueries([query, ...rewrites]);

    const perQuery = await Promise.all(
      queries.map((q) => this.retrieval.search(scope, q, RECALL_CANDIDATES, RECALL_MAX_DISTANCE)),
    );
    const candidates = this.fuseAcrossQueries(perQuery);
    log.debug('fused candidates:', candidates);

    const kept = await this.reranker.rerank(query, candidates);
    log.debug('kept after rerank:', kept);

    const assembled = await this.assembler.assemble(kept, maxTokens);

    log.info(
      `queries=${queries.length} candidates=${candidates.length} kept=${kept.length} took=${Date.now() - startedAt}ms`,
    );
    return assembled;
  }

  // Each query variant produced its own ranking; fuse them the same way the
  // per-branch rankings are fused — by rank, since scores are per-set relative.
  private fuseAcrossQueries(perQuery: ScoredItem[][]): ScoredItem[] {
    if (perQuery.length === 1) return perQuery[0] ?? [];
    const rankings = perQuery.map((scored) => scored.map(({ item }) => item));
    return normalizeScores(rrfFuse(rankings).slice(0, RECALL_CANDIDATES));
  }
}

export function dedupeQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const query of queries) {
    const normalized = query.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(query.trim());
  }
  return unique.slice(0, MAX_QUERY_VARIANTS);
}

export const recallService = new RecallService(
  new QueryRewriter(openAiGateway),
  retrievalService,
  new Reranker(openAiGateway),
  new ContextAssembler(pg),
);
