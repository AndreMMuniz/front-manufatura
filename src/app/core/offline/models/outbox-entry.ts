import { JsonValue, LocalRecord } from './local-record';
import { SyncStatus } from './sync-status';

export interface OutboxEntry<TPayload = JsonValue> {
  readonly localId: string;
  readonly idempotencyKey: string;
  readonly payloadSchemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly payload: TPayload;
  readonly canonicalPayload: string;
  readonly payloadHash: string;
  readonly ownerId: string;
  readonly status: SyncStatus;
  readonly businessStatus?: string;
  readonly dependencyIds: readonly string[];
  readonly attemptCount: number;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastAttemptAt?: string;
  readonly nextAttemptAt?: string;
  readonly synchronizedAt?: string;
  readonly errorCode?: string;
}

export interface PersistedCommand<TPayload = JsonValue> {
  readonly localId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly localRecord: LocalRecord<TPayload>;
  readonly outboxEntry: OutboxEntry<TPayload>;
  readonly committedAt: string;
}
