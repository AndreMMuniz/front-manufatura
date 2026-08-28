import { Injectable } from '@angular/core';

import {
  LOCAL_RECORDS_STORE,
  OUTBOX_STORE,
  SYNC_RECEIPTS_STORE,
} from '../database/database-schema';
import { OfflineDatabase } from '../database/offline-database';
import { JsonValue } from '../models/local-record';
import { toOfflineStorageError } from '../models/offline-storage-error';
import { OutboxEntry } from '../models/outbox-entry';
import { SyncReceiptRecord } from '../models/sync-receipt-record';
import { OutboxActivityService } from '../services/outbox-activity.service';
import { assertOwnerId, requestResult, transactionComplete } from './repository-utils';

export type CompactClosedAggregateResult = 'compacted' | 'ineligible';

@Injectable({ providedIn: 'root' })
export class SyncRetentionRepository {
  constructor(
    private readonly database: OfflineDatabase,
    private readonly activity: OutboxActivityService = new OutboxActivityService(null),
  ) {}

  async compactClosedAggregate(
    ownerId: string,
    aggregateType: string,
    aggregateId: string,
    archivedAt: string,
    expiresAt: string,
  ): Promise<CompactClosedAggregateResult> {
    const owner = assertOwnerId(ownerId);
    const transaction = await this.database.createTransaction(
      [LOCAL_RECORDS_STORE, OUTBOX_STORE, SYNC_RECEIPTS_STORE],
      'readwrite',
    );
    const completed = transactionComplete(transaction);

    try {
      const localStore = transaction.objectStore(LOCAL_RECORDS_STORE);
      const outboxStore = transaction.objectStore(OUTBOX_STORE);
      const receiptStore = transaction.objectStore(SYNC_RECEIPTS_STORE);
      const [aggregateOutbox, ownerOutbox] = await Promise.all([
        requestResult<OutboxEntry<JsonValue>[]>(
          outboxStore
            .index('ownerAggregateOrder')
            .getAll(aggregateRange(owner, aggregateType, aggregateId)),
          'Não foi possível consultar o agregado sincronizado.',
        ),
        requestResult<OutboxEntry<JsonValue>[]>(
          outboxStore.index('ownerId').getAll(owner),
          'Não foi possível revalidar as dependências do owner.',
        ),
      ]);

      const allSynced =
        aggregateOutbox.length > 0 &&
        aggregateOutbox.every((entry) => entry.status === 'SYNCED' && entry.receipt);
      const ended = aggregateOutbox.some((entry) => entry.commandType === 'END_OPERATION');
      const localIds = new Set(aggregateOutbox.map((entry) => entry.localId));
      const hasActiveDependent = ownerOutbox.some(
        (entry) =>
          entry.status !== 'SYNCED' &&
          entry.dependencyIds.some((dependencyId) => localIds.has(dependencyId)),
      );

      if (!allSynced || !ended || hasActiveDependent) {
        await completed;
        return 'ineligible';
      }

      for (const entry of aggregateOutbox) {
        const archived: SyncReceiptRecord = {
          localId: entry.localId,
          ownerId: entry.ownerId,
          idempotencyKey: entry.idempotencyKey,
          aggregateType: entry.aggregateType,
          aggregateId: entry.aggregateId,
          commandType: entry.commandType,
          status: 'SYNCED',
          occurredAt: entry.occurredAt,
          createdAt: entry.createdAt,
          synchronizedAt: entry.synchronizedAt!,
          archivedAt,
          expiresAt,
          receipt: entry.receipt!,
        };
        receiptStore.put(archived);
        outboxStore.delete(entry.localId);
        localStore.delete(entry.localId);
      }

      await completed;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // A transação pode já ter sido abortada pela request que falhou.
      }
      try {
        await completed;
      } catch {
        // Preserva a causa original observada no bloco de compactação.
      }
      throw toOfflineStorageError(error, 'Não foi possível compactar o agregado sincronizado.');
    }

    this.activity.publish();
    return 'compacted';
  }

  async pruneReceipts(ownerId: string, now: string, maxRecords: number): Promise<number> {
    const owner = assertOwnerId(ownerId);
    if (!Number.isInteger(maxRecords) || maxRecords < 1) {
      throw new TypeError('maxRecords deve ser um inteiro positivo.');
    }

    const transaction = await this.database.createTransaction([SYNC_RECEIPTS_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(SYNC_RECEIPTS_STORE);
    const records = await requestResult<SyncReceiptRecord[]>(
      store.index('ownerId').getAll(owner),
      'Não foi possível listar os recibos sincronizados.',
    );
    const ordered = [...records].sort(
      (left, right) =>
        Date.parse(right.archivedAt) - Date.parse(left.archivedAt) ||
        right.archivedAt.localeCompare(left.archivedAt) ||
        right.localId.localeCompare(left.localId),
    );
    const nowTimestamp = Date.parse(now);
    const expired = ordered.filter((record) => Date.parse(record.expiresAt) <= nowTimestamp);
    const overflow = ordered.slice(Math.max(0, maxRecords));
    const deleteIds = new Set([...expired, ...overflow].map((record) => record.localId));

    for (const localId of deleteIds) store.delete(localId);
    await completed;
    return deleteIds.size;
  }
}

function aggregateRange(
  owner: string,
  aggregateType: string,
  aggregateId: string,
): IDBKeyRange | undefined {
  return globalThis.IDBKeyRange?.bound(
    [owner, aggregateType, aggregateId],
    [owner, aggregateType, aggregateId, []],
  );
}
