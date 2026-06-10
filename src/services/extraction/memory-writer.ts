import { eq } from 'drizzle-orm';
import { memories, messages } from '../../db/schema';
import { createLogger } from '../../lib/logger';
import {
  embeddingText,
  type Database,
  type ExtractTurnInput,
  type LlmGateway,
  type MemoryOp,
} from './types';

const log = createLogger('extraction');

type MergeOp = Extract<MemoryOp, { kind: 'merge' }>;

export class MemoryWriter {
  constructor(
    private readonly db: Database,
    private readonly llm: LlmGateway,
  ) {}

  async write(
    input: ExtractTurnInput,
    messageEmbeddings: number[][],
    ops: MemoryOp[],
  ): Promise<void> {
    const mergedEmbeddingByOp = await this.embedMergedValues(ops);

    await this.db.transaction(async (tx) => {
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

  // The merged value differs from the candidate text, so it needs its own embedding;
  // on failure the candidate's embedding is a close-enough fallback.
  private async embedMergedValues(ops: MemoryOp[]): Promise<Map<MemoryOp, number[]>> {
    const mergeOps = ops.filter((op): op is MergeOp => op.kind === 'merge');
    const mergedEmbeddingByOp = new Map<MemoryOp, number[]>();
    if (mergeOps.length === 0) return mergedEmbeddingByOp;

    try {
      const mergedEmbeddings = await this.llm.embedTexts(
        mergeOps.map((op) => embeddingText(op.candidate.key, op.mergedValue)),
      );
      mergeOps.forEach((op, i) => {
        const embedding = mergedEmbeddings[i];
        if (embedding) mergedEmbeddingByOp.set(op, embedding);
      });
    } catch (err) {
      log.warn('merged-value embedding failed, falling back to candidate embeddings:', err);
    }
    return mergedEmbeddingByOp;
  }
}
