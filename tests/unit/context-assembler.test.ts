import { describe, expect, it } from 'vitest';
import type { MemoryId } from '../../src/lib/ids';
import { asTurnId } from '../../src/lib/ids';
import { ContextAssembler } from '../../src/services/recall/context-assembler';
import { fakeSql, memoryItem, messageItem } from './fakes';

const FACTS_HEADER = '## Known facts about this user';
const CONVERSATION_HEADER = '## Relevant from recent conversations';

describe('ContextAssembler.assemble', () => {
  it('returns an empty result for no kept items', async () => {
    const assembler = new ContextAssembler(fakeSql());
    expect(await assembler.assemble([], 1024)).toEqual({ context: '', citations: [] });
  });

  it('renders facts before conversation snippets regardless of input order', async () => {
    const assembler = new ContextAssembler(fakeSql());
    const fact = memoryItem({ value: 'User lives in Bergen.' });
    const msg = messageItem({ content: 'Hello from the fjords' });
    const { context, citations } = await assembler.assemble(
      [
        { item: msg, score: 0.5 },
        { item: fact, score: 1 },
      ],
      1024,
    );

    expect(context.indexOf(FACTS_HEADER)).toBe(0);
    expect(context.indexOf(FACTS_HEADER)).toBeLessThan(context.indexOf(CONVERSATION_HEADER));
    expect(context).toContain('- User lives in Bergen. (fact, updated 2026-01-02)');
    expect(context).toContain('- [2026-01-02] user: Hello from the fjords');
    expect(citations.map((c) => c.turn_id)).toEqual([fact.turnId, msg.turnId]);
  });

  it('renders the superseded predecessor value as "; previously: ..."', async () => {
    const assembler = new ContextAssembler(
      fakeSql([{ id: 'old-1', value: 'User lives in Oslo.' }]),
    );
    const fact = memoryItem({
      value: 'User lives in Bergen.',
      supersedesId: 'old-1' as MemoryId,
    });
    const { context } = await assembler.assemble([{ item: fact, score: 1 }], 1024);
    expect(context).toContain(
      '- User lives in Bergen. (fact, updated 2026-01-02; previously: User lives in Oslo.)',
    );
  });

  it('suppresses raw messages from a turn already distilled into a kept fact', async () => {
    const assembler = new ContextAssembler(fakeSql());
    const turnId = asTurnId('turn-shared');
    const fact = memoryItem({ turnId, value: 'Meeting is on July 8.' });
    const msg = messageItem({ turnId, content: 'on July 3rd... no wait, the 8th' });
    const { context, citations } = await assembler.assemble(
      [
        { item: fact, score: 1 },
        { item: msg, score: 0.9 },
      ],
      1024,
    );

    expect(context).not.toContain(CONVERSATION_HEADER);
    expect(context).not.toContain('July 3rd');
    expect(citations).toHaveLength(1);
  });

  it('keeps suppressing a turn even when its fact did not fit the budget', async () => {
    const assembler = new ContextAssembler(fakeSql());
    const turnId = asTurnId('turn-shared');
    const oversizedFact = memoryItem({ turnId, value: 'a'.repeat(400) });
    const leakyMessage = messageItem({ turnId, content: 'Hi' });
    const tight = await assembler.assemble(
      [
        { item: oversizedFact, score: 1 },
        { item: leakyMessage, score: 0.9 },
      ],
      20,
    );
    // The fact was dropped for size — its raw source message must NOT take its
    // place: that is exactly the pre-correction leak the suppression prevents.
    expect(tight).toEqual({ context: '', citations: [] });

    const unrelatedMessage = messageItem({ content: 'Hi' });
    const control = await assembler.assemble([{ item: unrelatedMessage, score: 1 }], 20);
    expect(control.context).toContain(CONVERSATION_HEADER);
  });

  it('admits only what fits the token budget', async () => {
    const assembler = new ContextAssembler(fakeSql());
    const facts = Array.from({ length: 10 }, () => memoryItem({ value: 'a'.repeat(100) }));
    const { context, citations } = await assembler.assemble(
      facts.map((item) => ({ item, score: 1 })),
      50,
    );
    // header ~10 tokens + each line ~34: exactly one line fits a 50-token budget.
    expect(context.split('\n')).toHaveLength(2);
    expect(citations).toHaveLength(1);
  });

  it('budgets non-ASCII text denser than ASCII (script-aware estimation)', async () => {
    const assembler = new ContextAssembler(fakeSql());
    const budget = 50;

    const ascii = await assembler.assemble(
      [{ item: memoryItem({ value: 'a'.repeat(100) }), score: 1 }],
      budget,
    );
    expect(ascii.context).not.toBe('');

    // Same char count, but Cyrillic ≈ 2 chars/token — double the cost, over budget.
    const cyrillic = await assembler.assemble(
      [{ item: memoryItem({ value: 'я'.repeat(100) }), score: 1 }],
      budget,
    );
    expect(cyrillic.context).toBe('');
  });

  it('truncates snippets and omits citations for facts without a source turn', async () => {
    const assembler = new ContextAssembler(fakeSql());
    const longMessage = messageItem({ content: 'x'.repeat(400) });
    const orphanFact = memoryItem({ turnId: null });
    const { citations } = await assembler.assemble(
      [
        { item: orphanFact, score: 1 },
        { item: longMessage, score: 0.5 },
      ],
      1024,
    );
    expect(citations).toHaveLength(1);
    expect(citations[0]!.snippet).toHaveLength(200);
  });
});
