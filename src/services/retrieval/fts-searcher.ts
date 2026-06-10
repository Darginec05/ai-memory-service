import type { SqlClient } from '../../db/client';
import { createLogger } from '../../lib/logger';
import { memoryScopeSql, messageScopeSql } from './scope';
import { mapMemoryRow, mapMessageRow } from './row-mappers';
import type { RetrievalScope, RetrievedMemory, RetrievedMessage } from './types';

const log = createLogger('retrieval');

export class FtsSearcher {
  constructor(private readonly sql: SqlClient) { }

  // websearch_to_tsquery tolerates arbitrary user input (quotes, operators, unicode)
  // without ever throwing a syntax error, unlike to_tsquery.
  async searchMemories(
    scope: RetrievalScope,
    query: string,
    limit: number,
  ): Promise<RetrievedMemory[]> {
    const rows = await this.sql`
      SELECT id, type, key, value, confidence, session_id, source_turn, supersedes_id, created_at, updated_at
      FROM memories
      WHERE active AND ${memoryScopeSql(this.sql, scope)}
        AND tsv @@ websearch_to_tsquery('simple', ${query})
      ORDER BY ts_rank(tsv, websearch_to_tsquery('simple', ${query})) DESC
      LIMIT ${limit}`;

    log.debug('FTS memories rows:', rows);
    return rows.map(mapMemoryRow);
  }

  async searchMessages(
    scope: RetrievalScope,
    query: string,
    limit: number,
  ): Promise<RetrievedMessage[]> {
    const rows = await this.sql`
      SELECT m.id, m.role, m.content, t.session_id, t.id AS turn_id, t.ts
      FROM messages m
      JOIN turns t ON t.id = m.turn_id
      WHERE ${messageScopeSql(this.sql, scope)}
        AND m.tsv @@ websearch_to_tsquery('simple', ${query})
      ORDER BY ts_rank(m.tsv, websearch_to_tsquery('simple', ${query})) DESC
      LIMIT ${limit}`;

    log.debug('FTS messages rows:', rows);
    return rows.map(mapMessageRow);
  }
}
