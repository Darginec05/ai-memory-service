import { z } from 'zod';
// import type keeps db/client out of the runtime graph — unit tests can import
// these types without instantiating the Postgres client.
import type { db, pg } from '../../db/client';
import { MEMORY_TYPES, type MemoryType, type MessageRole } from '../../db/schema';
import type { MemoryId, MessageId, SessionId, TurnId, UserId } from '../../lib/ids';
import type { StructuredCallArgs } from '../../lib/openai';

export type Database = typeof db;
export type SqlClient = typeof pg;

export interface LlmGateway {
  completeStructured(args: StructuredCallArgs): Promise<unknown>;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export const candidateSchema = z.object({
  type: z.enum(MEMORY_TYPES),
  key: z.string().min(1),
  value: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export type Candidate = z.infer<typeof candidateSchema>;

export type RelatedMemory = {
  id: MemoryId;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
};

export type MemoryOp =
  | { kind: 'add'; candidate: Candidate; embedding: number[] }
  | { kind: 'supersede'; candidate: Candidate; embedding: number[]; targetId: MemoryId }
  | { kind: 'merge'; candidate: Candidate; embedding: number[]; mergedValue: string; targetId: MemoryId }
  | { kind: 'reinforce'; targetId: MemoryId; confidence: number };

export type ExtractionMessage = {
  id: MessageId;
  role: MessageRole;
  content: string;
};

export type ExtractTurnInput = {
  turnId: TurnId;
  sessionId: SessionId;
  userId: UserId | null;
  messages: ReadonlyArray<ExtractionMessage>;
};

export function embeddingText(key: string, value: string): string {
  return `${key}: ${value}`;
}
