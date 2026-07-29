import { JsonValue } from './local-record';

export interface SyncCommandRequest {
  readonly localId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly payloadSchemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly payload: JsonValue;
  readonly canonicalPayload: string;
  readonly occurredAt: string;
}

export interface CommandResult {
  readonly serverRecordId: string;
  readonly idempotencyKey: string;
  readonly receivedAt: string;
  readonly processedAt: string;
  readonly duplicate: boolean;
  readonly correlationId?: string;
}
