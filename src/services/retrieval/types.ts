import type { MemoryType, MessageRole } from '../../db/schema';

export type RetrievalScope =
  | { kind: 'user'; userId: string }
  | { kind: 'session'; sessionId: string };

export type RetrievedMemory = {
  source: 'memory';
  id: string;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  sessionId: string;
  turnId: string | null;
  supersedesId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RetrievedMessage = {
  source: 'message';
  id: string;
  role: MessageRole;
  content: string;
  sessionId: string;
  turnId: string;
  ts: Date;
};

export type RetrievedItem = RetrievedMemory | RetrievedMessage;

export type ScoredItem = {
  item: RetrievedItem;
  score: number;
};

export function itemKey(item: RetrievedItem): string {
  return `${item.source}:${item.id}`;
}
