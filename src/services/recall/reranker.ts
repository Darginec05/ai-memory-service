import { z } from 'zod';
import { createLogger } from '../../lib/logger';
import type { ScoredItem } from '../retrieval';
import type { LlmGateway } from './types';

const log = createLogger('recall');

const RERANK_SNIPPET_CHARS = 300;
// Oversized payload guard: keeps a pathological query from bloating the LLM call.
const MAX_QUESTION_CHARS = 2000;

const RERANK_SYSTEM = `You select which retrieved candidates are relevant context for an AI agent about to answer a question about its user.

Rules:
- Drop candidates about topics unrelated to the question; order the rest most relevant first.
- Keep ALL facts on the question's topic, including changes and events (quit a job, moved, started something new) — together they describe the current state. Do not collapse to a single best match: a dropped fact cannot be recovered downstream, an extra one is cheap.
- Structured facts are authoritative and already reconciled. Drop a conversation snippet when its information is covered by a kept fact: raw snippets may contain stale or self-corrected values (e.g. a message stating a wrong date and then the correction — the fact stores only the corrected one).
- Keep a snippet only when it adds relevant detail that no fact covers.
- For multi-hop questions, keep every fact in the chain, not just the final answer.
- If nothing is relevant to the question, return an empty list — that is a normal outcome, never pad it.`;

const RERANK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    keep: { type: 'array', items: { type: 'integer' } },
  },
  required: ['keep'],
  additionalProperties: false,
};

const rerankResultSchema = z.object({
  keep: z.array(z.number().int().min(0)),
});

export class Reranker {
  constructor(private readonly llm: LlmGateway) { }

  // Failure degrades to the fused RRF order — worse precision, never an error.
  async rerank(question: string, candidates: ScoredItem[]): Promise<ScoredItem[]> {
    if (candidates.length === 0) return [];

    const userMessage = buildRerankUserMessage(question, candidates);
    log.debug('rerank prompt:', userMessage);

    try {
      const raw = await this.llm.completeStructured({
        label: 'rerank',
        system: RERANK_SYSTEM,
        user: userMessage,
        schemaName: 'rerank_selection',
        schema: RERANK_JSON_SCHEMA,
      });
      const keep = rerankResultSchema.parse(raw).keep;

      const seen = new Set<number>();
      const kept: ScoredItem[] = [];
      for (const index of keep) {
        if (seen.has(index)) continue;
        seen.add(index);
        const candidate = candidates[index];
        if (candidate) kept.push(candidate);
      }
      return kept;
    } catch (err) {
      log.warn('rerank failed, keeping fused order:', err);
      return candidates;
    }
  }
}

function buildRerankUserMessage(question: string, candidates: ScoredItem[]): string {
  const lines = candidates.map(({ item }, i) => {
    if (item.source === 'memory') return `${i}. [${item.type}] ${item.value}`;
    return `${i}. [snippet, ${item.role}] ${item.content.slice(0, RERANK_SNIPPET_CHARS)}`;
  });
  return `Question: ${question.slice(0, MAX_QUESTION_CHARS)}\n\nCandidates:\n${lines.join('\n')}`;
}
