import { Hono } from 'hono';
import { z } from 'zod';
import { readJson } from '../lib/http';
import { retrievalService, scopeFromRequest, type RetrievedItem } from '../services/retrieval';

const SNIPPET_CHAR_LIMIT = 300;

const searchSchema = z.object({
  query: z.string().min(1),
  session_id: z.string().nullish(),
  user_id: z.string().nullish(),
  limit: z.number().int().positive().max(100).optional().default(10),
});

type SearchResult = {
  content: string;
  score: number;
  session_id: string;
  timestamp: string;
  metadata: Record<string, unknown>;
};

type SearchResponse = {
  results: SearchResult[];
};

function toSearchResult(item: RetrievedItem, score: number): SearchResult {
  if (item.source === 'memory') {
    return {
      content: item.value,
      score,
      session_id: item.sessionId,
      timestamp: item.updatedAt.toISOString(),
      metadata: {
        source: 'memory',
        id: item.id,
        type: item.type,
        key: item.key,
        confidence: item.confidence,
        turn_id: item.turnId,
      },
    };
  }
  return {
    content: item.content.slice(0, SNIPPET_CHAR_LIMIT),
    score,
    session_id: item.sessionId,
    timestamp: item.ts.toISOString(),
    metadata: {
      source: 'message',
      id: item.id,
      role: item.role,
      turn_id: item.turnId,
    },
  };
}

export const searchRoute = new Hono();

searchRoute.post('/search', async (c) => {
  const body = await readJson(c, searchSchema);
  if (!body.ok) return body.res;

  const scope = scopeFromRequest(body.data.user_id, body.data.session_id);
  if (!scope) {
    const empty: SearchResponse = { results: [] };
    return c.json(empty);
  }

  const scored = await retrievalService.search(scope, body.data.query, body.data.limit);

  const response: SearchResponse = {
    results: scored.map(({ item, score }) => toSearchResult(item, score)),
  };
  return c.json(response);
});
