type AppConfig = {
  readonly port: number;
  readonly databaseUrl: string;
  readonly openaiApiKey: string;
  readonly authToken: string;
};

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://memory:memory@localhost:5432/memory',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  authToken: process.env.MEMORY_AUTH_TOKEN ?? '',
};
