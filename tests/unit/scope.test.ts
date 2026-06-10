import { describe, expect, it } from 'vitest';
import { scopeFromRequest } from '../../src/services/retrieval/scope';

describe('scopeFromRequest', () => {
  it('prefers user scope when user_id is present (cross-session by design)', () => {
    expect(scopeFromRequest('u1', 's1')).toEqual({ kind: 'user', userId: 'u1' });
    expect(scopeFromRequest('u1', null)).toEqual({ kind: 'user', userId: 'u1' });
  });

  it('falls back to session scope when only session_id is present', () => {
    expect(scopeFromRequest(null, 's1')).toEqual({ kind: 'session', sessionId: 's1' });
    expect(scopeFromRequest(undefined, 's1')).toEqual({ kind: 'session', sessionId: 's1' });
  });

  it('returns null when neither id is usable', () => {
    expect(scopeFromRequest(null, null)).toBeNull();
    expect(scopeFromRequest(undefined, undefined)).toBeNull();
    expect(scopeFromRequest('', '')).toBeNull();
  });

  it('treats an empty user_id as absent rather than as a user scope', () => {
    expect(scopeFromRequest('', 's1')).toEqual({ kind: 'session', sessionId: 's1' });
  });
});
