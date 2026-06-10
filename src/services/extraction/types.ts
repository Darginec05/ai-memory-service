import { z } from 'zod';
import { MEMORY_TYPES, type MemoryType, type MessageRole } from '../../db/schema';

export type { Database, SqlClient } from '../../db/client';
export type { LlmGateway } from '../../lib/openai';

export const candidateSchema = z.object({
  type: z.enum(MEMORY_TYPES),
  key: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type Candidate = z.infer<typeof candidateSchema>;

export type RelatedMemory = {
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
};

export type MemoryOp =
  | { kind: 'add'; candidate: Candidate; embedding: number[] }
  | { kind: 'supersede'; candidate: Candidate; embedding: number[]; targetId: string }
  | { kind: 'merge'; candidate: Candidate; embedding: number[]; mergedValue: string; targetId: string }
  | { kind: 'reinforce'; targetId: string; confidence: number };

export type ExtractionMessage = {
  id: string;
  role: MessageRole;
  content: string;
};

export type ExtractTurnInput = {
  turnId: string;
  sessionId: string;
  userId: string | null;
  messages: ReadonlyArray<ExtractionMessage>;
};

export function embeddingText(key: string, value: string): string {
  return `${key}: ${value}`;
}
