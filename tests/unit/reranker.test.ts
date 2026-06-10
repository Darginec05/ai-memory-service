import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Reranker } from '../../src/services/recall/reranker';
import type { ScoredItem } from '../../src/services/retrieval';
import { fakeLlm, memoryItem, messageItem } from './fakes';

// Degradation paths warn by design; silenced here (vitest's console
// interception also chokes on serializing ZodError instances).
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

function candidates(): ScoredItem[] {
  return [
    { item: memoryItem({ value: 'User lives in Bergen.' }), score: 1 },
    { item: memoryItem({ value: 'User has a cat named Жужа.' }), score: 0.8 },
    { item: messageItem({ content: 'I moved to Bergen last month.' }), score: 0.6 },
  ];
}

describe('Reranker.rerank', () => {
  it('returns empty without calling the LLM when there are no candidates', async () => {
    const llm = fakeLlm(() => ({ keep: [] }));
    expect(await new Reranker(llm.gateway).rerank('q', [])).toEqual([]);
    expect(llm.calls).toHaveLength(0);
  });

  it('keeps and reorders candidates by the returned indices', async () => {
    const llm = fakeLlm(() => ({ keep: [2, 0] }));
    const input = candidates();
    const kept = await new Reranker(llm.gateway).rerank('q', input);
    expect(kept).toEqual([input[2], input[0]]);
  });

  it('ignores duplicate and out-of-range indices', async () => {
    const llm = fakeLlm(() => ({ keep: [1, 1, 99] }));
    const input = candidates();
    const kept = await new Reranker(llm.gateway).rerank('q', input);
    expect(kept).toEqual([input[1]]);
  });

  it('degrades to the fused order when the LLM call fails', async () => {
    const llm = fakeLlm(() => {
      throw new Error('llm down');
    });
    const input = candidates();
    expect(await new Reranker(llm.gateway).rerank('q', input)).toBe(input);
  });

  it('degrades to the fused order on a malformed LLM response', async () => {
    const llm = fakeLlm(() => ({ keep: [-1] }));
    const input = candidates();
    expect(await new Reranker(llm.gateway).rerank('q', input)).toBe(input);
  });

  it('renders facts and truncated snippets distinctly in the prompt', async () => {
    const llm = fakeLlm(() => ({ keep: [] }));
    const input: ScoredItem[] = [
      { item: memoryItem({ value: 'User lives in Bergen.' }), score: 1 },
      { item: messageItem({ content: 'x'.repeat(400) }), score: 0.5 },
    ];
    await new Reranker(llm.gateway).rerank('where does the user live?', input);

    const prompt = llm.calls[0]!.user;
    expect(prompt).toContain('0. [fact] User lives in Bergen.');
    expect(prompt).toContain(`1. [snippet, user] ${'x'.repeat(300)}`);
    expect(prompt).not.toContain('x'.repeat(301));
  });

  it('truncates an oversized question in the prompt', async () => {
    const llm = fakeLlm(() => ({ keep: [] }));
    await new Reranker(llm.gateway).rerank('q'.repeat(3000), candidates());
    const prompt = llm.calls[0]!.user;
    expect(prompt).toContain('q'.repeat(2000));
    expect(prompt).not.toContain('q'.repeat(2001));
  });
});
