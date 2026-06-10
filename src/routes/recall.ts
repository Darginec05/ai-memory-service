import { Hono } from 'hono';
import { z } from 'zod';
import { readJson } from '../lib/http';
import { retrievalService, scopeFromRequest, type ScoredItem } from '../services/retrieval';

// Interim assembly (v3): hybrid retrieval + priority buckets under a char budget.
// TODO(recall): query decomposition for multi-hop, LLM rerank, supersession-aware
// "previously ..." rendering.

const RECALL_CANDIDATES = 24;
const APPROX_CHARS_PER_TOKEN = 4;
const SNIPPET_CHAR_LIMIT = 200;

const recallSchema = z.object({
  query: z.string().min(1),
  session_id: z.string().min(1),
  user_id: z.string().nullish(),
  max_tokens: z.number().int().positive().optional().default(1024),
});

type Citation = {
  turn_id: string;
  score: number;
  snippet: string;
};

type RecallResponse = {
  context: string;
  citations: Citation[];
};

type AssembledContext = {
  context: string;
  citations: Citation[];
};

const FACTS_HEADER = '## Known facts about this user';
const CONVERSATION_HEADER = '## Relevant from recent conversations';
// Header line + the '\n\n' section separator, paid once per non-empty section.
const SECTION_OVERHEAD = 2;

// Priority under budget (task §3): stable user facts first, then conversation
// snippets — a fact distilled from N turns is denser than any single turn.
function assembleContext(scored: ScoredItem[], maxTokens: number): AssembledContext {
  const budgetChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  const factLines: string[] = [];
  const conversationLines: string[] = [];
  const citations: Citation[] = [];
  let usedChars = 0;

  const tryAdd = (lines: string[], header: string, line: string): boolean => {
    const headerCost = lines.length === 0 ? header.length + SECTION_OVERHEAD : 0;
    const cost = headerCost + line.length + 1; // +1 for the joining newline
    if (usedChars + cost > budgetChars) return false;
    lines.push(line);
    usedChars += cost;
    return true;
  };

  for (const { item, score } of scored) {
    if (item.source !== 'memory') continue;
    const date = item.updatedAt.toISOString().slice(0, 10);
    if (!tryAdd(factLines, FACTS_HEADER, `- ${item.value} (${item.type}, updated ${date})`)) continue;
    if (item.turnId) {
      citations.push({ turn_id: item.turnId, score, snippet: item.value.slice(0, SNIPPET_CHAR_LIMIT) });
    }
  }

  for (const { item, score } of scored) {
    if (item.source !== 'message') continue;
    const date = item.ts.toISOString().slice(0, 10);
    const snippet = item.content.slice(0, SNIPPET_CHAR_LIMIT);
    if (!tryAdd(conversationLines, CONVERSATION_HEADER, `- [${date}] ${item.role}: ${snippet}`)) continue;
    citations.push({ turn_id: item.turnId, score, snippet });
  }

  const sections: string[] = [];
  if (factLines.length > 0) sections.push(`${FACTS_HEADER}\n${factLines.join('\n')}`);
  if (conversationLines.length > 0) {
    sections.push(`${CONVERSATION_HEADER}\n${conversationLines.join('\n')}`);
  }

  return { context: sections.join('\n\n'), citations };
}

export const recallRoute = new Hono();

recallRoute.post('/recall', async (c) => {
  const body = await readJson(c, recallSchema);
  if (!body.ok) return body.res;

  const scope = scopeFromRequest(body.data.user_id, body.data.session_id);
  if (!scope) {
    const empty: RecallResponse = { context: '', citations: [] };
    return c.json(empty);
  }

  const scored = await retrievalService.search(scope, body.data.query, RECALL_CANDIDATES);
  const assembled = assembleContext(scored, body.data.max_tokens);

  const response: RecallResponse = {
    context: assembled.context,
    citations: assembled.citations,
  };
  return c.json(response);
});
