import type { MemoryType } from '../../db/schema';
import type { MemoryId, SessionId, UserId } from '../../lib/ids';
import type { RelatedMemory, SqlClient } from './types';

const RELATED_LIMIT = 8;
const RELATED_DISTANCE_THRESHOLD = 0.55;

export class RelatedMemoryFinder {
  constructor(private readonly sql: SqlClient) {}

  // Hybrid lookup: exact key match catches stable topics, the embedding fallback
  // catches the same topic under a differently-minted key (observed in v1 testing).
  async findRelated(
    userId: UserId | null,
    sessionId: SessionId,
    key: string,
    embedding: number[],
  ): Promise<RelatedMemory[]> {
    const vec = `[${embedding.join(',')}]`;
    const scope = userId
      ? this.sql`user_id = ${userId}`
      : this.sql`user_id IS NULL AND session_id = ${sessionId}`;

    const rows = await this.sql`
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
}
