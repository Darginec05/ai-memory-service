import type { SqlClient } from '../../db/client';
import { mapMemoryRow, mapMessageRow } from './row-mappers';
import { memoryScopeSql, messageScopeSql } from './scope';
import type { RetrievalScope, RetrievedMemory, RetrievedMessage } from './types';

// Cosine distance above this is noise for text-embedding-3-small: returning
// "nearest of nothing relevant" is how hallucinated recall happens. Callers
// with a downstream precision stage (rerank) may pass a looser cutoff.
export const DEFAULT_MAX_DISTANCE = 0.6;

export class VectorSearcher {
  constructor(private readonly sql: SqlClient) {}

  async searchMemories(
    scope: RetrievalScope,
    queryEmbedding: number[],
    limit: number,
    maxDistance: number,
  ): Promise<RetrievedMemory[]> {
    const vec = toVectorLiteral(queryEmbedding);
    const rows = await this.sql`
      SELECT id, type, key, value, confidence, session_id, source_turn, supersedes_id, created_at, updated_at
      FROM memories
      WHERE active AND ${memoryScopeSql(this.sql, scope)}
        AND embedding IS NOT NULL
        AND embedding <=> ${vec}::vector < ${maxDistance}
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${limit}`;
    return rows.map(mapMemoryRow);
  }

  async searchMessages(
    scope: RetrievalScope,
    queryEmbedding: number[],
    limit: number,
    maxDistance: number,
  ): Promise<RetrievedMessage[]> {
    const vec = toVectorLiteral(queryEmbedding);
    const rows = await this.sql`
      SELECT m.id, m.role, m.content, t.session_id, t.id AS turn_id, t.ts
      FROM messages m
      JOIN turns t ON t.id = m.turn_id
      WHERE ${messageScopeSql(this.sql, scope)}
        AND m.embedding IS NOT NULL
        AND m.embedding <=> ${vec}::vector < ${maxDistance}
      ORDER BY m.embedding <=> ${vec}::vector
      LIMIT ${limit}`;
    return rows.map(mapMessageRow);
  }
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
