import type { Row } from 'postgres';
import { describe, expect, it } from 'vitest';
import { mapMemoryRow, mapMessageRow } from '../../src/services/retrieval/row-mappers';

const memoryRow = {
  id: 'mem-1',
  type: 'fact',
  key: 'location.city',
  value: 'User lives in Bergen.',
  confidence: 0.9,
  session_id: 's1',
  source_turn: 'turn-1',
  supersedes_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T12:30:00.000Z',
} as unknown as Row;

describe('mapMemoryRow', () => {
  it('parses string timestamptz values into Dates (postgres-js raw rows)', () => {
    const mapped = mapMemoryRow(memoryRow);
    expect(mapped.createdAt).toBeInstanceOf(Date);
    expect(mapped.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(mapped.updatedAt.toISOString()).toBe('2026-01-02T12:30:00.000Z');
  });

  it('maps nullable columns to null', () => {
    const mapped = mapMemoryRow({ ...memoryRow, source_turn: null, supersedes_id: undefined } as unknown as Row);
    expect(mapped.turnId).toBeNull();
    expect(mapped.supersedesId).toBeNull();
  });

  it('throws on an unparseable timestamp instead of producing Invalid Date', () => {
    const broken = { ...memoryRow, created_at: 'garbage' } as unknown as Row;
    expect(() => mapMemoryRow(broken)).toThrow(/unparseable timestamp/);
  });
});

describe('mapMessageRow', () => {
  it('passes Date instances through unchanged', () => {
    const ts = new Date('2026-02-03T08:00:00Z');
    const mapped = mapMessageRow({
      id: 'msg-1',
      role: 'user',
      content: 'hello',
      session_id: 's1',
      turn_id: 'turn-1',
      ts,
    } as unknown as Row);
    expect(mapped.ts).toBe(ts);
    expect(mapped.source).toBe('message');
  });
});
