type Brand<T, B extends string> = T & { readonly __brand: B };

export type TurnId = Brand<string, 'TurnId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type UserId = Brand<string, 'UserId'>;

export function asTurnId(value: string): TurnId {
  return value as TurnId;
}

export function asSessionId(value: string): SessionId {
  return value as SessionId;
}

export function asUserId(value: string): UserId {
  return value as UserId;
}
