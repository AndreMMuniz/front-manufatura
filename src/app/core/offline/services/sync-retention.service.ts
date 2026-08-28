import { Inject, Injectable } from '@angular/core';

import { OutboxRepository } from '../repositories/outbox.repository';
import { SyncRetentionRepository } from '../repositories/sync-retention.repository';
import { SYNC_CLOCK, SyncClock } from './sync-coordinator.service';

export const SYNC_RETENTION_DAYS = 30;
export const SYNC_RETENTION_MAX_PER_OWNER = 500;

export interface SyncRetentionSummary {
  readonly compactedAggregates: number;
  readonly prunedReceipts: number;
}

@Injectable({ providedIn: 'root' })
export class SyncRetentionService {
  constructor(
    private readonly outbox: OutboxRepository,
    private readonly retention: SyncRetentionRepository,
    @Inject(SYNC_CLOCK) private readonly clock: SyncClock,
  ) {}

  async cleanupOwner(ownerId: string): Promise<SyncRetentionSummary> {
    const now = this.clock();
    const archivedAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + SYNC_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const entries = await this.outbox.listByOwner(ownerId);
    const aggregateKeys = new Set<string>();
    let compactedAggregates = 0;

    for (const entry of entries) {
      if (entry.commandType !== 'END_OPERATION' || entry.status !== 'SYNCED') {
        continue;
      }

      const aggregateKey = `${entry.aggregateType}\u0000${entry.aggregateId}`;
      if (aggregateKeys.has(aggregateKey)) {
        continue;
      }
      aggregateKeys.add(aggregateKey);

      const result = await this.retention.compactClosedAggregate(
        ownerId,
        entry.aggregateType,
        entry.aggregateId,
        archivedAt,
        expiresAt,
      );
      if (result === 'compacted') {
        compactedAggregates += 1;
      }
    }

    const prunedReceipts = await this.retention.pruneReceipts(
      ownerId,
      archivedAt,
      SYNC_RETENTION_MAX_PER_OWNER,
    );
    return { compactedAggregates, prunedReceipts };
  }
}
