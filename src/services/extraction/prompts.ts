import { MEMORY_TYPES } from '../../db/schema';

export const EXTRACTION_SYSTEM = `You are the extraction module of a long-term memory service for an AI agent.
Given a conversation turn (and optional earlier context from the same session), extract durable, queryable knowledge about the user and their world.

Memory types:
- "fact": stable facts about the user and their world — identity, work, location, family, possessions, skills, health, projects, relationships between people and things in their life.
- "preference": likes, dislikes, habits, how the user wants things done.
- "opinion": judgments and evaluations that may evolve over time.
- "event": time-bound occurrences, plans, deadlines — things that happened or will happen, not standing facts.

Rules:
1. Extract only knowledge grounded in what the user said or explicitly confirmed. Assistant speculation is not knowledge. Tool output is context only — never a fact about the user.
2. Capture implicit facts: a passing mention implies knowledge (taking a daughter to practice implies the user has a daughter).
3. Handle corrections: if the user corrects something ("actually...", "no, I meant..."), extract only the corrected version.
4. Each "value" must be a single self-contained sentence understandable without the conversation: resolve all pronouns and references using the provided context.
5. Write "value" in the same language the user used.
6. "key" is a lowercase dot-notation topic identifier in English used to group related knowledge, e.g. "employment", "location.home", "family.daughter", "health.allergy", "hobby.climbing", "preference.communication". Invent new keys freely in this style; reuse the same key for the same topic.
7. "confidence": 0.85-0.95 for explicit statements, 0.55-0.75 for implicit inferences. Below 0.5 — do not extract at all.
8. Do not extract: small talk, transient task details with no future value, the assistant's own suggestions or knowledge.
9. If nothing is worth remembering, return an empty list. That is a normal outcome.

Example. User said: "Ugh, my wrist is acting up again from bouldering. Anyway — draft a reply to my landlord, we agreed to extend the lease till June."
Extract:
- type "fact", key "health.wrist", value "User has a recurring wrist problem aggravated by bouldering.", confidence 0.85
- type "fact", key "hobby.bouldering", value "User goes bouldering.", confidence 0.7
- type "event", key "housing.lease", value "User agreed with their landlord to extend their lease until June.", confidence 0.9

Example. User said: "Honestly after last night's raid I think our guild leader has no idea what he's doing." (earlier context: user plays an MMO with a guild)
Extract:
- type "opinion", key "gaming.guild_leader", value "User thinks their MMO guild leader is incompetent.", confidence 0.85`;

export const EXTRACTION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...MEMORY_TYPES] },
          key: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['type', 'key', 'value', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['memories'],
  additionalProperties: false,
};

const MAX_PROMPT_MESSAGE_CHARS = 6000;

type PromptMessage = {
  role: string;
  content: string;
};

export function buildExtractionUserMessage(
  recentContext: string,
  turnMessages: ReadonlyArray<PromptMessage>,
): string {
  const turnBlock = turnMessages
    .map((m) => `${m.role}: ${m.content.slice(0, MAX_PROMPT_MESSAGE_CHARS)}`)
    .join('\n');
  const contextBlock = recentContext
    ? `Earlier in this session:\n${recentContext}\n\n`
    : '';
  return `${contextBlock}Current turn:\n${turnBlock}`;
}

export const RECONCILIATION_SYSTEM = `You reconcile newly extracted memories with the user's existing memory store.
For each new memory candidate, decide exactly one action:
- "add": genuinely new knowledge; no existing memory covers it. Two facts on the same topic can coexist (e.g. owning two different pets) — coexistence is "add", not a contradiction.
- "reinforce": an existing memory already states the same thing; nothing new is learned.
- "supersede": the candidate directly contradicts or replaces an existing memory — the world changed (moved, changed jobs, relationship ended, plan changed).
- "merge": an evolving opinion or preference on the same subject. Provide "merged_value": one self-contained sentence synthesizing the current overall stance, in the same language as the candidate. The evolution matters — do not simply restate the newest message.

Refer to existing memories by their "id". For "add", "existing_id" must be null. "merged_value" must be null unless the action is "merge".
Output one decision per candidate, in the same order as the candidates (candidate_index).`;

export const RECONCILIATION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          candidate_index: { type: 'integer' },
          action: { type: 'string', enum: ['add', 'reinforce', 'supersede', 'merge'] },
          existing_id: { type: ['string', 'null'] },
          merged_value: { type: ['string', 'null'] },
        },
        required: ['candidate_index', 'action', 'existing_id', 'merged_value'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
};

type CandidateForPrompt = {
  type: string;
  key: string;
  value: string;
};

type ExistingForPrompt = {
  id: string;
  type: string;
  key: string;
  value: string;
};

export function buildReconciliationUserMessage(
  candidates: ReadonlyArray<CandidateForPrompt>,
  existing: ReadonlyArray<ExistingForPrompt>,
): string {
  const candidatesBlock = candidates
    .map((cand, i) => `${i}. [${cand.type}] ${cand.key}: ${cand.value}`)
    .join('\n');
  const existingBlock = existing
    .map((m) => `id=${m.id} [${m.type}] ${m.key}: ${m.value}`)
    .join('\n');
  return `New candidates:\n${candidatesBlock}\n\nExisting active memories:\n${existingBlock}`;
}
