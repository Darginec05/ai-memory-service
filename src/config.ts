const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_COMPLETION_MODEL = 'gpt-4o-mini';

type AppConfig = {
  readonly port: number;
  readonly databaseUrl: string;
  readonly openaiApiKey: string;
  readonly authToken: string;
  readonly embeddingModel: string;
  readonly completionModel: string;
};

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://memory:memory@localhost:5432/memory',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  authToken: process.env.MEMORY_AUTH_TOKEN ?? '',
  embeddingModel: process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
  completionModel: process.env.COMPLETION_MODEL || DEFAULT_COMPLETION_MODEL,
};
