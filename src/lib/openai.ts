import OpenAI from 'openai';
import { config } from '../config';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const COMPLETION_MODEL = 'gpt-4o-mini';

const MAX_EMBED_INPUT_CHARS = 8000;

export class LlmUnavailableError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set — LLM features are disabled');
    this.name = 'LlmUnavailableError';
  }
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!config.openaiApiKey) throw new LlmUnavailableError();
  if (!client) client = new OpenAI({ apiKey: config.openaiApiKey });
  return client;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LlmUnavailableError) throw err;
    console.warn(`[openai] ${label} failed, retrying once:`, err);
    return fn();
  }
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  // The embeddings API rejects empty strings; a single space keeps array positions aligned.
  const input = texts.map((t) => t.slice(0, MAX_EMBED_INPUT_CHARS) || ' ');
  const res = await withRetry('embeddings', () =>
    getClient().embeddings.create({ model: EMBEDDING_MODEL, input }),
  );
  return res.data.map((d) => d.embedding);
}

type StructuredCallArgs = {
  label: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

export async function completeStructured(args: StructuredCallArgs): Promise<unknown> {
  const res = await withRetry(args.label, () =>
    getClient().chat.completions.create({
      model: COMPLETION_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: args.user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: args.schemaName, strict: true, schema: args.schema },
      },
    }),
  );
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error(`[openai] ${args.label}: empty completion`);
  return JSON.parse(content) as unknown;
}
