import { describe, expect, it } from 'vitest';
import type { MemoryId } from '../../src/lib/ids';
import { Reconciler } from '../../src/services/extraction/reconciler';
import type { Candidate, RelatedMemory } from '../../src/services/extraction/types';
import { fakeLlm } from './fakes';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return { type: 'fact', key: 'job', value: 'User works at Notion.', confidence: 0.9, ...overrides };
}

function related(overrides: Partial<RelatedMemory> = {}): RelatedMemory {
  return {
    id: 'm1' as MemoryId,
    type: 'fact',
    key: 'job',
    value: 'User works at Stripe.',
    confidence: 0.8,
    ...overrides,
  };
}

type Decision = {
  candidate_index: number;
  action: 'add' | 'reinforce' | 'supersede' | 'merge';
  existing_id: string | null;
  merged_value: string | null;
};

function decisions(...items: Decision[]): { decisions: Decision[] } {
  return { decisions: items };
}

describe('Reconciler.reconcile', () => {
  it('skips the LLM entirely when no candidate has related memories', async () => {
    const llm = fakeLlm(() => decisions());
    const ops = await new Reconciler(llm.gateway).reconcile(
      [candidate(), candidate({ key: 'pet' })],
      [[0.1], [0.2]],
      [[], []],
    );
    expect(llm.calls).toHaveLength(0);
    expect(ops.map((op) => op.kind)).toEqual(['add', 'add']);
  });

  it('drops a candidate whose embedding is missing instead of writing a broken row', async () => {
    const llm = fakeLlm(() => decisions());
    const ops = await new Reconciler(llm.gateway).reconcile(
      [candidate(), candidate({ key: 'pet' })],
      [[0.1]],
      [[], []],
    );
    expect(ops).toHaveLength(1);
  });

  it('maps a supersede decision onto the related target', async () => {
    const target = related();
    const llm = fakeLlm(() =>
      decisions({ candidate_index: 0, action: 'supersede', existing_id: 'm1', merged_value: null }),
    );
    const ops = await new Reconciler(llm.gateway).reconcile([candidate()], [[0.1]], [[target]]);
    expect(ops).toEqual([
      { kind: 'supersede', candidate: candidate(), embedding: [0.1], targetId: 'm1' },
    ]);
  });

  it('reinforce keeps the higher of target and candidate confidence', async () => {
    const llm = fakeLlm(() =>
      decisions({ candidate_index: 0, action: 'reinforce', existing_id: 'm1', merged_value: null }),
    );
    const ops = await new Reconciler(llm.gateway).reconcile(
      [candidate({ confidence: 0.7 })],
      [[0.1]],
      [[related({ confidence: 0.95 })]],
    );
    expect(ops).toEqual([{ kind: 'reinforce', targetId: 'm1', confidence: 0.95 }]);
  });

  it('merge uses the synthesized value, falling back to the candidate value', async () => {
    const llm = fakeLlm(() =>
      decisions({
        candidate_index: 0,
        action: 'merge',
        existing_id: 'm1',
        merged_value: 'User liked TS, now finds generics annoying.',
      }),
    );
    const reconciler = new Reconciler(llm.gateway);
    const [op] = await reconciler.reconcile([candidate()], [[0.1]], [[related()]]);
    expect(op).toMatchObject({
      kind: 'merge',
      mergedValue: 'User liked TS, now finds generics annoying.',
    });

    const fallbackLlm = fakeLlm(() =>
      decisions({ candidate_index: 0, action: 'merge', existing_id: 'm1', merged_value: null }),
    );
    const [fallbackOp] = await new Reconciler(fallbackLlm.gateway).reconcile(
      [candidate()],
      [[0.1]],
      [[related()]],
    );
    expect(fallbackOp).toMatchObject({ kind: 'merge', mergedValue: 'User works at Notion.' });
  });

  it('degrades an invalid or missing target to an add — never drops knowledge', async () => {
    const invalidTarget = fakeLlm(() =>
      decisions({ candidate_index: 0, action: 'supersede', existing_id: 'nope', merged_value: null }),
    );
    const ops = await new Reconciler(invalidTarget.gateway).reconcile(
      [candidate()],
      [[0.1]],
      [[related()]],
    );
    expect(ops.map((op) => op.kind)).toEqual(['add']);

    const nullTarget = fakeLlm(() =>
      decisions({ candidate_index: 0, action: 'supersede', existing_id: null, merged_value: null }),
    );
    const ops2 = await new Reconciler(nullTarget.gateway).reconcile(
      [candidate()],
      [[0.1]],
      [[related()]],
    );
    expect(ops2.map((op) => op.kind)).toEqual(['add']);
  });

  it('takes only the first decision per candidate index', async () => {
    const llm = fakeLlm(() =>
      decisions(
        { candidate_index: 0, action: 'supersede', existing_id: 'm1', merged_value: null },
        { candidate_index: 0, action: 'reinforce', existing_id: 'm1', merged_value: null },
      ),
    );
    const ops = await new Reconciler(llm.gateway).reconcile([candidate()], [[0.1]], [[related()]]);
    expect(ops.map((op) => op.kind)).toEqual(['supersede']);
  });

  it('adds candidates the LLM left undecided', async () => {
    const llm = fakeLlm(() =>
      decisions({ candidate_index: 0, action: 'reinforce', existing_id: 'm1', merged_value: null }),
    );
    const ops = await new Reconciler(llm.gateway).reconcile(
      [candidate(), candidate({ key: 'pet', value: 'User has a cat.' })],
      [[0.1], [0.2]],
      [[related()], []],
    );
    expect(ops.map((op) => op.kind)).toEqual(['reinforce', 'add']);
  });
});
