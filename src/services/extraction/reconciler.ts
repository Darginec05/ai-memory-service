import { z } from 'zod';
import {
  RECONCILIATION_JSON_SCHEMA,
  RECONCILIATION_SYSTEM,
  buildReconciliationUserMessage,
} from './prompts';
import type { Candidate, LlmGateway, MemoryOp, RelatedMemory } from './types';

const decisionSchema = z.object({
  candidate_index: z.number().int().min(0),
  action: z.enum(['add', 'reinforce', 'supersede', 'merge']),
  existing_id: z.string().nullable(),
  merged_value: z.string().nullable(),
});

const reconciliationResultSchema = z.object({
  decisions: z.array(decisionSchema),
});

export class Reconciler {
  constructor(private readonly llm: LlmGateway) {}

  async reconcile(
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

    // No related memories means no possible conflict — skip the LLM call entirely.
    if (allRelated.size === 0) {
      return candidates.map((_, i) => addOp(i)).filter((op): op is MemoryOp => op !== null);
    }

    const raw = await this.llm.completeStructured({
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

    // Candidates the LLM forgot to decide on are still knowledge — add them.
    for (let i = 0; i < candidates.length; i++) {
      if (decidedIndexes.has(i)) continue;
      const op = addOp(i);
      if (op) ops.push(op);
    }

    return ops;
  }
}
