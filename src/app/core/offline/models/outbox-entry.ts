import { JsonValue, LocalRecord } from './local-record';
import { DeliveryDisposition } from './delivery-disposition';
import { SyncErrorCategory } from './sync-error';
import { SyncStatus } from './sync-status';

export interface PersistedSyncError {
  readonly code: string;
  readonly category: SyncErrorCategory;
  readonly userMessage: string;
  readonly correlationId?: string;
}

export interface RemoteCommandReceipt {
  readonly serverRecordId: string;
  readonly receivedAt: string;
  readonly processedAt: string;
  readonly duplicate: boolean;
  readonly correlationId?: string;
  readonly orderResults?: readonly {
    readonly orderId: string;
    readonly success: boolean;
    readonly serverRecordId?: string;
    readonly errorCode?: string;
  }[];
  readonly businessResult?: JsonValue;
}

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
  readonly authBlockReason?: 'SESSION' | 'SUPERVISOR';
  readonly businessStatus?: string;
  readonly dependencyIds: readonly string[];
  readonly attemptCount: number;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastAttemptAt?: string;
  readonly nextAttemptAt?: string;
  readonly synchronizedAt?: string;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: string;
  readonly receipt?: RemoteCommandReceipt;
  readonly lastError?: PersistedSyncError;
  readonly manualRetryCount?: number;
  readonly lastManualRetryAt?: string;
  readonly lastManualRetryBy?: string;
  readonly deliveryDisposition?: DeliveryDisposition;
  readonly logicalOccurredAt?: string;
  readonly supersedesLocalId?: string;
  readonly supersededByLocalId?: string;
  readonly supersededAt?: string;
  readonly supersededBy?: string;
  readonly abandonedAt?: string;
  readonly abandonedBy?: string;
  readonly abandonReason?: string;
  readonly abandonPermission?: string;
}

export interface PersistedCommand<TPayload = JsonValue> {
  readonly localId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly localRecord: LocalRecord<TPayload>;
  readonly outboxEntry: OutboxEntry<TPayload>;
  readonly committedAt: string;
}
