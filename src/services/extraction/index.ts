import { db, pg } from '../../db/client';
import { openAiGateway } from '../../lib/openai';
import { CandidateExtractor } from './candidate-extractor';
import { MemoryWriter } from './memory-writer';
import { Reconciler } from './reconciler';
import { RelatedMemoryFinder } from './related-finder';
import {
  embeddingText,
  type ExtractTurnInput,
  type LlmGateway,
  type MemoryOp,
  type RelatedMemory,
} from './types';

export type { ExtractTurnInput } from './types';

export class ExtractionService {
  constructor(
    private readonly candidateExtractor: CandidateExtractor,
    private readonly relatedFinder: RelatedMemoryFinder,
    private readonly reconciler: Reconciler,
    private readonly memoryWriter: MemoryWriter,
    private readonly llm: LlmGateway,
  ) {}

  async processTurn(input: ExtractTurnInput): Promise<void> {
    const startedAt = Date.now();

    const candidates = await this.candidateExtractor.extract(
      input.sessionId,
      input.turnId,
      input.messages,
    );

    console.log(`ExtractionService [processTurn] -> candidates`, candidates);

    // Messages and candidates share one embeddings call to save a round-trip.
    const messageTexts = input.messages.map((m) => m.content);
    const candidateTexts = candidates.map((cand) => embeddingText(cand.key, cand.value));
    const allEmbeddings = await this.llm.embedTexts([...messageTexts, ...candidateTexts]);
    const messageEmbeddings = allEmbeddings.slice(0, messageTexts.length);
    const candidateEmbeddings = allEmbeddings.slice(messageTexts.length);

    const relatedPerCandidate = await Promise.all(
      candidates.map((cand, i): Promise<RelatedMemory[]> => {
        const embedding = candidateEmbeddings[i];
        if (!embedding) return Promise.resolve([]);
        return this.relatedFinder.findRelated(input.userId, input.sessionId, cand.key, embedding);
      }),
    );

    const ops = await this.reconciler.reconcile(candidates, candidateEmbeddings, relatedPerCandidate);

    await this.memoryWriter.write(input, messageEmbeddings, ops);

    console.log(
      `[extraction] turn=${input.turnId} candidates=${candidates.length} took=${Date.now() - startedAt}ms ops:`,
      ops.map(describeOp),
    );
  }
}

type OpSummary =
  | { kind: 'reinforce'; targetId: string }
  | { kind: Exclude<MemoryOp['kind'], 'reinforce'>; key: string; value: string };

function describeOp(op: MemoryOp): OpSummary {
  return op.kind === 'reinforce'
    ? { kind: op.kind, targetId: op.targetId }
    : { kind: op.kind, key: op.candidate.key, value: op.candidate.value };
}

export const extractionService = new ExtractionService(
  new CandidateExtractor(db, openAiGateway),
  new RelatedMemoryFinder(pg),
  new Reconciler(openAiGateway),
  new MemoryWriter(db, openAiGateway),
  openAiGateway,
);
