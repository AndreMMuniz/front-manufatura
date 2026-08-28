import { RemoteCommandReceipt } from './outbox-entry';

export interface SyncReceiptRecord {
  readonly localId: string;
  readonly ownerId: string;
  readonly idempotencyKey: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly status: 'SYNCED';
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly synchronizedAt: string;
  readonly archivedAt: string;
  readonly expiresAt: string;
  readonly receipt: RemoteCommandReceipt;
}
