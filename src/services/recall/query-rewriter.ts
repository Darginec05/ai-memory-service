import { z } from 'zod';
import { createLogger } from '../../lib/logger';
import type { LlmGateway } from './types';

const log = createLogger('recall');

const MAX_REWRITES = 3;
// Oversized payload guard: keeps a pathological query from bloating the LLM call.
const MAX_QUESTION_CHARS = 2000;

const REWRITE_SYSTEM = `You rewrite a question into search queries for a personal-memory database.

The database stores knowledge about a user as third-person declarative sentences, mostly in English (e.g. "User has moved to Bergen.", "User's sister Maren lives in Lisbon."). It also stores raw conversation messages in their original language.

Rewrite the question into 1-${MAX_REWRITES} search queries that will match this storage:
- English, third person, declarative or keyword style (e.g. "where i live?" -> "user's current city of residence").
- Keep proper names (people, pets, places, products) EXACTLY as written, including non-Latin scripts — never translate or transliterate them.
- If answering requires connecting several distinct facts (multi-hop), output one query per fact (e.g. "what city does the user with the dog named Rex live in?" -> "user has a dog named Rex" + "user's current city of residence").
- Only rephrase what is asked; never invent details that are not in the question.`;

const REWRITE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    queries: { type: 'array', items: { type: 'string' } },
  },
  required: ['queries'],
  additionalProperties: false,
};

const rewriteResultSchema = z.object({
  queries: z.array(z.string().min(1)),
});

export class QueryRewriter {
  constructor(private readonly llm: LlmGateway) {}

  // Rewriting only ever adds search branches — the original query is always
  // searched too, so a bad rewrite cannot lose recall. Failure degrades to [].
  async rewrite(query: string): Promise<string[]> {
    try {
      const raw = await this.llm.completeStructured({
        label: 'query-rewrite',
        system: REWRITE_SYSTEM,
        user: query.slice(0, MAX_QUESTION_CHARS),
        schemaName: 'search_queries',
        schema: REWRITE_JSON_SCHEMA,
      });

      log.debug('rewrite response:', raw);
      return rewriteResultSchema.parse(raw).queries.slice(0, MAX_REWRITES);
    } catch (err) {
      log.warn('query rewriting failed, searching raw query only:', err);
      return [];
    }
  }
}
