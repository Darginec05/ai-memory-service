import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryRewriter } from '../../src/services/recall/query-rewriter';
import { fakeLlm } from './fakes';

// Degradation paths warn by design; silenced here (vitest's console
// interception also chokes on serializing ZodError instances).
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe('QueryRewriter.rewrite', () => {
  it('returns the rewritten queries from the LLM', async () => {
    const llm = fakeLlm(() => ({ queries: ['user current city of residence', 'user has moved'] }));
    const rewriter = new QueryRewriter(llm.gateway);
    expect(await rewriter.rewrite('where i live?')).toEqual([
      'user current city of residence',
      'user has moved',
    ]);
  });

  it('caps the number of rewrites at 3', async () => {
    const llm = fakeLlm(() => ({ queries: ['a', 'b', 'c', 'd', 'e'] }));
    const rewriter = new QueryRewriter(llm.gateway);
    expect(await rewriter.rewrite('q')).toEqual(['a', 'b', 'c']);
  });

  it('degrades to no rewrites when the LLM call fails', async () => {
    const llm = fakeLlm(() => {
      throw new Error('llm down');
    });
    const rewriter = new QueryRewriter(llm.gateway);
    expect(await rewriter.rewrite('where i live?')).toEqual([]);
  });

  it('degrades to no rewrites on a malformed LLM response', async () => {
    const badShape = fakeLlm(() => ({ nope: true }));
    expect(await new QueryRewriter(badShape.gateway).rewrite('q')).toEqual([]);

    const emptyString = fakeLlm(() => ({ queries: ['ok', ''] }));
    expect(await new QueryRewriter(emptyString.gateway).rewrite('q')).toEqual([]);
  });

  it('truncates an oversized question before sending it to the LLM', async () => {
    const llm = fakeLlm(() => ({ queries: [] }));
    await new QueryRewriter(llm.gateway).rewrite('q'.repeat(3000));
    expect(llm.calls[0]!.user).toHaveLength(2000);
  });
});
