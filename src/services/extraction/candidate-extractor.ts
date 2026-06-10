import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { messages, turns } from '../../db/schema';
import { EXTRACTION_JSON_SCHEMA, EXTRACTION_SYSTEM, buildExtractionUserMessage } from './prompts';
import {
  candidateSchema,
  type Candidate,
  type Database,
  type ExtractionMessage,
  type LlmGateway,
} from './types';

const RECENT_CONTEXT_MESSAGES = 12;
const RECENT_CONTEXT_CHAR_LIMIT = 500;
const MAX_CANDIDATES = 12;
const MIN_CONFIDENCE = 0.5;

const extractionResultSchema = z.object({
  memories: z.array(candidateSchema),
});

export class CandidateExtractor {
  constructor(
    private readonly db: Database,
    private readonly llm: LlmGateway,
  ) {}

  async extract(
    sessionId: string,
    turnId: string,
    turnMessages: ReadonlyArray<ExtractionMessage>,
  ): Promise<Candidate[]> {
    const recentContext = await this.loadRecentContext(sessionId, turnId);

    const raw = await this.llm.completeStructured({
      label: 'extraction',
      system: EXTRACTION_SYSTEM,
      user: buildExtractionUserMessage(recentContext, turnMessages),
      schemaName: 'extracted_memories',
      schema: EXTRACTION_JSON_SCHEMA,
    });

    const parsed = extractionResultSchema.parse(raw);
    return parsed.memories
      .filter((cand) => cand.confidence >= MIN_CONFIDENCE)
      .slice(0, MAX_CANDIDATES)
      .map((cand) => ({ ...cand, key: normalizeKey(cand.key) }));
  }

  // Earlier session messages give the LLM coreference context ("she", "the new job")
  // without shipping the whole history into the prompt.
  private async loadRecentContext(sessionId: string, currentTurnId: string): Promise<string> {
    const rows = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .innerJoin(turns, eq(messages.turnId, turns.id))
      .where(and(eq(turns.sessionId, sessionId), ne(turns.id, currentTurnId)))
      .orderBy(desc(turns.createdAt), desc(messages.idx))
      .limit(RECENT_CONTEXT_MESSAGES);

    return rows
      .reverse()
      .map((r) => `${r.role}: ${r.content.slice(0, RECENT_CONTEXT_CHAR_LIMIT)}`)
      .join('\n');
  }
}

export function normalizeKey(raw: string): string {
  const key = raw.toLowerCase().trim().replace(/\s+/g, '.').slice(0, 64);
  return key || 'other';
}
