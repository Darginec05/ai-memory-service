import type { ScoredItem } from '../retrieval';
import type { AssembledRecall, Citation, SqlClient } from './types';

const SNIPPET_CHAR_LIMIT = 200;
const FACTS_HEADER = '## Known facts about this user';
const CONVERSATION_HEADER = '## Relevant from recent conversations';
// Header newline + the '\n\n' section separator, paid once per non-empty section.
const SECTION_OVERHEAD_TOKENS = 2;

// ASCII averages ~4 chars/token; most non-ASCII (Cyrillic, CJK, emoji) tokenizes
// far denser, ~2 chars/token — a flat 4 would blow the budget ~2x on Russian.
function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4 + other / 2);
}

export class ContextAssembler {
  constructor(private readonly sql: SqlClient) {}

  // Priority under budget (task §3): stable user facts first, then conversation
  // snippets — a fact distilled from N turns is denser than any single turn.
  async assemble(scored: ScoredItem[], maxTokens: number): Promise<AssembledRecall> {
    const previousValues = await this.loadSupersededValues(scored);

    const factLines: string[] = [];
    const conversationLines: string[] = [];
    const citations: Citation[] = [];
    let usedTokens = 0;

    const tryAdd = (lines: string[], header: string, line: string): boolean => {
      const headerCost = lines.length === 0 ? estimateTokens(header) + SECTION_OVERHEAD_TOKENS : 0;
      const cost = headerCost + estimateTokens(line) + 1;
      if (usedTokens + cost > maxTokens) return false;
      lines.push(line);
      usedTokens += cost;
      return true;
    };

    // A fact already distills its source turn. Quoting that turn's raw messages
    // adds no information but can leak pre-correction values the user retracted
    // ("3rd... no wait, the 8th" — the fact stores only the 8th). Collected from
    // ALL kept facts, not just budget-admitted ones: a tight budget must not
    // swap a fact out for its rawer, pre-correction source message.
    const factTurnIds = new Set<string>();
    for (const { item } of scored) {
      if (item.source === 'memory' && item.turnId) factTurnIds.add(item.turnId);
    }

    for (const { item, score } of scored) {
      if (item.source !== 'memory') continue;
      const date = item.updatedAt.toISOString().slice(0, 10);
      const previous = item.supersedesId ? previousValues.get(item.supersedesId) : undefined;
      const history = previous ? `; previously: ${previous}` : '';
      if (!tryAdd(factLines, FACTS_HEADER, `- ${item.value} (${item.type}, updated ${date}${history})`)) continue;
      if (item.turnId) {
        citations.push({ turn_id: item.turnId, score, snippet: item.value.slice(0, SNIPPET_CHAR_LIMIT) });
      }
    }

    for (const { item, score } of scored) {
      if (item.source !== 'message') continue;
      if (factTurnIds.has(item.turnId)) continue;
      const date = item.ts.toISOString().slice(0, 10);
      const snippet = item.content.slice(0, SNIPPET_CHAR_LIMIT);
      if (!tryAdd(conversationLines, CONVERSATION_HEADER, `- [${date}] ${item.role}: ${snippet}`)) continue;
      citations.push({ turn_id: item.turnId, score, snippet });
    }

    const sections: string[] = [];
    if (factLines.length > 0) sections.push(`${FACTS_HEADER}\n${factLines.join('\n')}`);
    if (conversationLines.length > 0) {
      sections.push(`${CONVERSATION_HEADER}\n${conversationLines.join('\n')}`);
    }

    return { context: sections.join('\n\n'), citations };
  }

  // "previously ..." rendering: fetch the immediate predecessor of each
  // superseding fact so evolution is visible without bloating retrieval.
  private async loadSupersededValues(scored: ScoredItem[]): Promise<Map<string, string>> {
    const ids = scored
      .map(({ item }) => (item.source === 'memory' ? item.supersedesId : null))
      .filter((id): id is NonNullable<typeof id> => id !== null);
    if (ids.length === 0) return new Map();

    const rows = await this.sql`SELECT id, value FROM memories WHERE id IN ${this.sql(ids)}`;
    return new Map(rows.map((row) => [String(row.id), String(row.value)]));
  }
}
