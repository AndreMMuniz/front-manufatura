import { Inject, Injectable } from '@angular/core';

import { AuthSessionService } from '../../auth/auth-session.service';
import { OutboxRepository } from '../repositories/outbox.repository';
import { SyncRetentionRepository } from '../repositories/sync-retention.repository';
import { SYNC_CLOCK, SyncClock } from './sync-clock';

export const SYNC_RETENTION_DAYS = 30;
export const SYNC_RETENTION_MAX_PER_OWNER = 500;
export const SYNC_RETENTION_MAX_AGGREGATES_PER_RUN = 25;

export interface SyncRetentionSummary {
  readonly compactedAggregates: number;
  readonly prunedReceipts: number;
}

@Injectable({ providedIn: 'root' })
export class SyncRetentionService {
  private readonly activeCleanups = new Map<string, Promise<SyncRetentionSummary>>();

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly retention: SyncRetentionRepository,
    @Inject(SYNC_CLOCK) private readonly clock: SyncClock,
    @Inject(AuthSessionService)
    private readonly auth: AuthSessionService = { currentUser: null } as AuthSessionService,
  ) {}

  async cleanupCurrentOwner(): Promise<SyncRetentionSummary | null> {
    const ownerId = this.auth.currentUser?.id.trim();
    return ownerId ? this.cleanupOwner(ownerId) : null;
  }

  cleanupOwner(ownerId: string): Promise<SyncRetentionSummary> {
    const owner = ownerId.trim();
    const active = this.activeCleanups.get(owner);
    if (active) {
      return active;
    }

    const cleanup = this.runCleanupOwner(owner);
    this.activeCleanups.set(owner, cleanup);
    void cleanup.then(
      () => this.releaseCleanup(owner, cleanup),
      () => this.releaseCleanup(owner, cleanup),
    );
    return cleanup;
  }

  private async runCleanupOwner(ownerId: string): Promise<SyncRetentionSummary> {
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
      if (aggregateKeys.size >= SYNC_RETENTION_MAX_AGGREGATES_PER_RUN) {
        break;
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

  private releaseCleanup(ownerId: string, cleanup: Promise<SyncRetentionSummary>): void {
    if (this.activeCleanups.get(ownerId) === cleanup) {
      this.activeCleanups.delete(ownerId);
    }
  }
}
