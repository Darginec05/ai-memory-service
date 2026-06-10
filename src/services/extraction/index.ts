import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, pg } from '../../db/client';
import {
  MEMORY_TYPES,
  memories,
  messages,
  turns,
  type MemoryType,
  type MessageRole,
} from '../../db/schema';
import type { MemoryId, MessageId, SessionId, TurnId, UserId } from '../../lib/ids';
import { completeStructured, embedTexts } from '../../lib/openai';
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_SYSTEM,
  RECONCILIATION_JSON_SCHEMA,
  RECONCILIATION_SYSTEM,
  buildExtractionUserMessage,
  buildReconciliationUserMessage,
} from './prompts';

const RECENT_CONTEXT_MESSAGES = 12;
const RECENT_CONTEXT_CHAR_LIMIT = 500;
const MAX_CANDIDATES = 12;
const MIN_CONFIDENCE = 0.5;
const RELATED_LIMIT = 8;
const RELATED_DISTANCE_THRESHOLD = 0.55;

const candidateSchema = z.object({
  type: z.enum(MEMORY_TYPES),
  key: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const extractionResultSchema = z.object({
  memories: z.array(candidateSchema),
});

const decisionSchema = z.object({
  candidate_index: z.number().int().min(0),
  action: z.enum(['add', 'reinforce', 'supersede', 'merge']),
  existing_id: z.string().nullable(),
  merged_value: z.string().nullable(),
});

const reconciliationResultSchema = z.object({
  decisions: z.array(decisionSchema),
});

type Candidate = z.infer<typeof candidateSchema>;

type RelatedMemory = {
  id: MemoryId;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
};

type MemoryOp =
  | { kind: 'add'; candidate: Candidate; embedding: number[] }
  | { kind: 'supersede'; candidate: Candidate; embedding: number[]; targetId: MemoryId }
  | { kind: 'merge'; candidate: Candidate; embedding: number[]; mergedValue: string; targetId: MemoryId }
  | { kind: 'reinforce'; targetId: MemoryId; confidence: number };

export type ExtractTurnInput = {
  turnId: TurnId;
  sessionId: SessionId;
  userId: UserId | null;
  messages: ReadonlyArray<{ id: MessageId; role: MessageRole; content: string }>;
};

export async function processTurn(input: ExtractTurnInput): Promise<void> {
  const startedAt = Date.now();

  const recentContext = await loadRecentContext(input.sessionId, input.turnId);
  console.log(`[processTurn] recentContext`, recentContext);

  const candidates = await extractCandidates(recentContext, input.messages);
  console.log(`[processTurn] candidates`, candidates);

  const messageTexts = input.messages.map((m) => m.content);
  const candidateTexts = candidates.map((cand) => embeddingText(cand.key, cand.value));
  const allEmbeddings = await embedTexts([...messageTexts, ...candidateTexts]);
  const messageEmbeddings = allEmbeddings.slice(0, messageTexts.length);
  const candidateEmbeddings = allEmbeddings.slice(messageTexts.length);
  
  const relatedPerCandidate = await Promise.all(
    candidates.map((cand, i) => {
      const embedding = candidateEmbeddings[i];
      if (!embedding) return Promise.resolve<RelatedMemory[]>([]);
      return findRelated(input.userId, input.sessionId, cand.key, embedding);
    }),
  );

  const ops = await reconcile(candidates, candidateEmbeddings, relatedPerCandidate);
  console.log(`[processTurn] ops`, ops.map((op) => {
    const { embedding, ...rest } = op;
    return rest;
  }));

  await applyOps(input, messageEmbeddings, ops);

  const opCounts = ops.reduce<Record<string, number>>((acc, op) => {
    acc[op.kind] = (acc[op.kind] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[extraction] turn=${input.turnId} candidates=${candidates.length} ops=${JSON.stringify(opCounts)} took=${Date.now() - startedAt}ms`,
  );
}

function embeddingText(key: string, value: string): string {
  return `${key}: ${value}`;
}

function normalizeKey(raw: string): string {
  const key = raw.toLowerCase().trim().replace(/\s+/g, '.').slice(0, 64);
  return key || 'other';
}

async function loadRecentContext(sessionId: SessionId, currentTurnId: TurnId): Promise<string> {
  const rows = await db
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

async function extractCandidates(
  recentContext: string,
  turnMessages: ExtractTurnInput['messages'],
): Promise<Candidate[]> {
  const raw = await completeStructured({
    label: 'extraction',
    system: EXTRACTION_SYSTEM,
    user: buildExtractionUserMessage(recentContext, turnMessages),
    schemaName: 'extracted_memories',
    schema: EXTRACTION_JSON_SCHEMA,
  });

  console.log(`[extractCandidates] raw`, raw);
  console.log(`[extractCandidates] user messsage`, buildExtractionUserMessage(recentContext, turnMessages));

  const parsed = extractionResultSchema.parse(raw);
  return parsed.memories
    .filter((cand) => cand.confidence >= MIN_CONFIDENCE)
    .slice(0, MAX_CANDIDATES)
    .map((cand) => ({ ...cand, key: normalizeKey(cand.key) }));
}

async function findRelated(
  userId: UserId | null,
  sessionId: SessionId,
  key: string,
  embedding: number[],
): Promise<RelatedMemory[]> {
  const vec = `[${embedding.join(',')}]`;
  const scope = userId
    ? pg`user_id = ${userId}`
    : pg`user_id IS NULL AND session_id = ${sessionId}`;

  const rows = await pg`
    SELECT id, type, key, value, confidence
    FROM memories
    WHERE active AND ${scope}
      AND (
        key = ${key}
        OR (embedding IS NOT NULL AND embedding <=> ${vec}::vector < ${RELATED_DISTANCE_THRESHOLD})
      )
    ORDER BY CASE WHEN key = ${key} THEN 0 ELSE 1 END, embedding <=> ${vec}::vector
    LIMIT ${RELATED_LIMIT}`;

  return rows.map((row) => ({
    id: row.id as MemoryId,
    type: row.type as MemoryType,
    key: row.key as string,
    value: row.value as string,
    confidence: row.confidence as number,
  }));
}

async function reconcile(
  candidates: Candidate[],
  candidateEmbeddings: number[][],
  relatedPerCandidate: RelatedMemory[][],
): Promise<MemoryOp[]> {
  const allRelated = new Map<string, RelatedMemory>();
  for (const related of relatedPerCandidate.flat()) allRelated.set(related.id, related);

  const addOp = (i: number): MemoryOp | null => {
    const candidate = candidates[i];
    const embedding = candidateEmbeddings[i];
    if (!candidate || !embedding) return null;
    return { kind: 'add', candidate, embedding };
  };

  if (allRelated.size === 0) {
    return candidates.map((_, i) => addOp(i)).filter((op): op is MemoryOp => op !== null);
  }

  const raw = await completeStructured({
    label: 'reconciliation',
    system: RECONCILIATION_SYSTEM,
    user: buildReconciliationUserMessage(candidates, [...allRelated.values()]),
    schemaName: 'reconciliation_decisions',
    schema: RECONCILIATION_JSON_SCHEMA,
  });

  const parsed = reconciliationResultSchema.parse(raw);
  const ops: MemoryOp[] = [];
  const decidedIndexes = new Set<number>();

  for (const decision of parsed.decisions) {
    const i = decision.candidate_index;
    if (decidedIndexes.has(i)) continue;
    const candidate = candidates[i];
    const embedding = candidateEmbeddings[i];
    if (!candidate || !embedding) continue;
    decidedIndexes.add(i);

    const target = decision.existing_id ? allRelated.get(decision.existing_id) : undefined;

    // An invalid or missing target degrades to "add" — never drop knowledge.
    if (decision.action === 'add' || !target) {
      ops.push({ kind: 'add', candidate, embedding });
      continue;
    }

    switch (decision.action) {
      case 'reinforce':
        ops.push({
          kind: 'reinforce',
          targetId: target.id,
          confidence: Math.max(target.confidence, candidate.confidence),
        });
        break;
      case 'supersede':
        ops.push({ kind: 'supersede', candidate, embedding, targetId: target.id });
        break;
      case 'merge':
        ops.push({
          kind: 'merge',
          candidate,
          embedding,
          mergedValue: decision.merged_value ?? candidate.value,
          targetId: target.id,
        });
        break;
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    if (decidedIndexes.has(i)) continue;
    const op = addOp(i);
    if (op) ops.push(op);
  }

  return ops;
}

async function applyOps(
  input: ExtractTurnInput,
  messageEmbeddings: number[][],
  ops: MemoryOp[],
): Promise<void> {
  const mergeOps = ops.filter((op): op is Extract<MemoryOp, { kind: 'merge' }> => op.kind === 'merge');
  // The merged value differs from the candidate text, so it needs its own embedding;
  // on failure the candidate's embedding is a close-enough fallback.
  const mergedEmbeddingByOp = new Map<MemoryOp, number[]>();
  try {
    const mergedEmbeddings = await embedTexts(
      mergeOps.map((op) => embeddingText(op.candidate.key, op.mergedValue)),
    );
    mergeOps.forEach((op, i) => {
      const embedding = mergedEmbeddings[i];
      if (embedding) mergedEmbeddingByOp.set(op, embedding);
    });
  } catch (err) {
    console.warn('[extraction] merged-value embedding failed, falling back to candidate embeddings:', err);
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < input.messages.length; i++) {
      const message = input.messages[i];
      const embedding = messageEmbeddings[i];
      if (!message || !embedding) continue;
      await tx.update(messages).set({ embedding }).where(eq(messages.id, message.id));
    }

    const now = new Date();

    for (const op of ops) {
      switch (op.kind) {
        case 'add':
          await tx.insert(memories).values({
            userId: input.userId,
            sessionId: input.sessionId,
            type: op.candidate.type,
            key: op.candidate.key,
            value: op.candidate.value,
            confidence: op.candidate.confidence,
            sourceTurn: input.turnId,
            embedding: op.embedding,
          });
          break;
        case 'reinforce':
          await tx
            .update(memories)
            .set({ confidence: op.confidence, updatedAt: now })
            .where(eq(memories.id, op.targetId));
          break;
        case 'supersede':
        case 'merge': {
          await tx
            .update(memories)
            .set({ active: false, updatedAt: now })
            .where(eq(memories.id, op.targetId));
          const isMerge = op.kind === 'merge';
          await tx.insert(memories).values({
            userId: input.userId,
            sessionId: input.sessionId,
            type: op.candidate.type,
            key: op.candidate.key,
            value: isMerge ? op.mergedValue : op.candidate.value,
            confidence: op.candidate.confidence,
            sourceTurn: input.turnId,
            supersedesId: op.targetId,
            embedding: isMerge ? (mergedEmbeddingByOp.get(op) ?? op.embedding) : op.embedding,
          });
          break;
        }
      }
    }
  });
}
