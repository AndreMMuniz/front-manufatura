export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface LocalRecord<TPayload = JsonValue> {
  readonly localId: string;
  readonly idempotencyKey: string;
  readonly databaseVersion: number;
  readonly payloadSchemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly payload: TPayload;
  readonly canonicalPayload: string;
  readonly payloadHash: string;
  readonly ownerId: string;
  readonly businessStatus?: string;
  readonly dependencyIds: readonly string[];
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersistConfirmedCommandRequest<TPayload> {
  readonly ownerId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly payload: TPayload;
  readonly payloadSchemaVersion: number;
  readonly dependencyIds?: readonly string[];
  readonly idempotencyKey?: string;
  readonly occurredAt?: string;
  readonly businessStatus?: string;
}

export function normalizeDependencyIds(dependencyIds: readonly string[] | undefined): readonly string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const candidate of dependencyIds ?? []) {
    const dependencyId = candidate.trim();
    if (dependencyId && !seen.has(dependencyId)) {
      seen.add(dependencyId);
      normalized.push(dependencyId);
    }
  }

  return Object.freeze(normalized);
}
