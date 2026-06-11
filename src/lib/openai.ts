import OpenAI from 'openai';
import { config } from '../config';
import { createLogger } from './logger';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const COMPLETION_MODEL = 'gpt-4o-mini';

const MAX_EMBED_INPUT_CHARS = 8000;

// An immediate retry after a 429 is near-guaranteed to hit the same limit;
// honor Retry-After but cap it so /recall latency stays bounded.
const RATE_LIMIT_RETRY_CAP_MS = 2000;
const RATE_LIMIT_RETRY_DEFAULT_MS = 1000;
const TRANSIENT_RETRY_DELAY_MS = 500;

const log = createLogger('openai');

export class LlmUnavailableError extends Error {
  constructor() {
    super('OPENAI_API_KEY is not set — LLM features are disabled');
    this.name = 'LlmUnavailableError';
  }
}

export type StructuredCallArgs = {
  label: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

export interface LlmGateway {
  completeStructured(args: StructuredCallArgs): Promise<unknown>;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export class OpenAiGateway implements LlmGateway {
  private client: OpenAI | null = null;

  constructor(private readonly apiKey: string) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    // The embeddings API rejects empty strings; a single space keeps array positions aligned.
    const input = texts.map((t) => t.slice(0, MAX_EMBED_INPUT_CHARS) || ' ');
    const res = await this.withRetry('embeddings', () =>
      this.getClient().embeddings.create({ model: EMBEDDING_MODEL, input }),
    );
    return res.data.map((d) => d.embedding);
  }

  async completeStructured(args: StructuredCallArgs): Promise<unknown> {
    const res = await this.withRetry(args.label, () =>
      this.getClient().chat.completions.create({
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

  private getClient(): OpenAI {
    if (!this.apiKey) throw new LlmUnavailableError();
    if (!this.client) this.client = new OpenAI({ apiKey: this.apiKey });
    return this.client;
  }

  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await fn();
      log.debug(`${label} took=${Date.now() - startedAt}ms`);
      return result;
    } catch (err) {
      if (err instanceof LlmUnavailableError) throw err;
      const delayMs = retryDelayMs(err);
      log.warn(`${label} failed, retrying once in ${delayMs}ms:`, err);
      await sleep(delayMs);
      const result = await fn();
      log.debug(`${label} took=${Date.now() - startedAt}ms (after retry)`);
      return result;
    }
  }
}

function retryDelayMs(err: unknown): number {
  if (err instanceof OpenAI.APIError && err.status === 429) {
    const retryAfterSec = Number(err.headers?.get('retry-after'));
    const ms =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : RATE_LIMIT_RETRY_DEFAULT_MS;
    return Math.min(ms, RATE_LIMIT_RETRY_CAP_MS);
  }
  return TRANSIENT_RETRY_DELAY_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const openAiGateway: LlmGateway = new OpenAiGateway(config.openaiApiKey);
