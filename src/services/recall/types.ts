export type Citation = {
  turn_id: string;
  score: number;
  snippet: string;
};

export type AssembledRecall = {
  context: string;
  citations: Citation[];
};

export type { LlmGateway } from '../../lib/openai';
export type { SqlClient } from '../../db/client';
