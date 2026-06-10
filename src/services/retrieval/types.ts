import type { MemoryType, MessageRole } from '../../db/schema';
import type { MemoryId, MessageId, SessionId, TurnId, UserId } from '../../lib/ids';

export type RetrievalScope =
  | { kind: 'user'; userId: UserId }
  | { kind: 'session'; sessionId: SessionId };

export type RetrievedMemory = {
  source: 'memory';
  id: MemoryId;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  sessionId: SessionId;
  turnId: TurnId | null;
  supersedesId: MemoryId | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RetrievedMessage = {
  source: 'message';
  id: MessageId;
  role: MessageRole;
  content: string;
  sessionId: SessionId;
  turnId: TurnId;
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
