import { describe, expect, it, vi } from 'vitest';

import { OutboxEntry } from '../models/outbox-entry';
import { OutboxRepository } from '../repositories/outbox.repository';
import { SyncRetentionRepository } from '../repositories/sync-retention.repository';
import { SyncRetentionService } from './sync-retention.service';

const OWNER = 'operator-1';
const NOW = '2026-08-28T13:00:00.000Z';
const EXPIRES_AT = '2026-09-27T13:00:00.000Z';

describe('SyncRetentionService', () => {
  it('compacta uma vez cada operação encerrada e aplica a retenção do owner', async () => {
    const outbox = { listByOwner: vi.fn().mockResolvedValue([
      endEntry('op-1'),
      reportEntry('op-1'),
      endEntry('op-2'),
      endEntry('op-1'),
    ]) };
    const retention = {
      compactClosedAggregate: vi.fn().mockResolvedValue('compacted'),
      pruneReceipts: vi.fn().mockResolvedValue(3),
    };
    const service = createService(outbox, retention);

    await expect(service.cleanupOwner(OWNER)).resolves.toEqual({
      compactedAggregates: 2,
      prunedReceipts: 3,
    });

    expect(retention.compactClosedAggregate.mock.calls).toEqual([
      [OWNER, 'OPERATION', 'op-1', NOW, EXPIRES_AT],
      [OWNER, 'OPERATION', 'op-2', NOW, EXPIRES_AT],
    ]);
    expect(retention.pruneReceipts).toHaveBeenCalledWith(OWNER, NOW, 500);
  });

  it('não seleciona operação ativa nem encerramento que ainda não foi sincronizado', async () => {
    const outbox = { listByOwner: vi.fn().mockResolvedValue([
      reportEntry('op-1'),
      endEntry('op-2', 'ERROR'),
    ]) };
    const retention = {
      compactClosedAggregate: vi.fn(),
      pruneReceipts: vi.fn().mockResolvedValue(0),
    };
    const service = createService(outbox, retention);

    await expect(service.cleanupOwner(OWNER)).resolves.toEqual({
      compactedAggregates: 0,
      prunedReceipts: 0,
    });

    expect(retention.compactClosedAggregate).not.toHaveBeenCalled();
    expect(retention.pruneReceipts).toHaveBeenCalledWith(OWNER, NOW, 500);
  });

  it('não contabiliza uma compactação revalidada como inelegível', async () => {
    const outbox = { listByOwner: vi.fn().mockResolvedValue([endEntry('op-1')]) };
    const retention = {
      compactClosedAggregate: vi.fn().mockResolvedValue('ineligible'),
      pruneReceipts: vi.fn().mockResolvedValue(1),
    };
    const service = createService(outbox, retention);

    await expect(service.cleanupOwner(OWNER)).resolves.toEqual({
      compactedAggregates: 0,
      prunedReceipts: 1,
    });
  });
});

function createService(
  outbox: { readonly listByOwner: (ownerId: string) => Promise<readonly OutboxEntry[]> },
  retention: {
    readonly compactClosedAggregate: (
      ownerId: string,
      aggregateType: string,
      aggregateId: string,
      archivedAt: string,
      expiresAt: string,
    ) => Promise<'compacted' | 'ineligible'>;
    readonly pruneReceipts: (ownerId: string, now: string, maxRecords: number) => Promise<number>;
  },
): SyncRetentionService {
  return new SyncRetentionService(
    outbox as OutboxRepository,
    retention as SyncRetentionRepository,
    () => new Date(NOW),
  );
}

function endEntry(aggregateId: string, status: OutboxEntry['status'] = 'SYNCED'): OutboxEntry {
  return entry(aggregateId, 'END_OPERATION', status);
}

function reportEntry(aggregateId: string): OutboxEntry {
  return entry(aggregateId, 'REPORT_OPERATION', 'SYNCED');
}

function entry(
  aggregateId: string,
  commandType: string,
  status: OutboxEntry['status'],
): OutboxEntry {
  return {
    localId: `${aggregateId}-${commandType}-${status}`,
    idempotencyKey: `${aggregateId}-${commandType}-${status}`,
    payloadSchemaVersion: 1,
    aggregateType: 'OPERATION',
    aggregateId,
    commandType,
    payload: {},
    canonicalPayload: '{}',
    payloadHash: 'hash',
    ownerId: OWNER,
    status,
    dependencyIds: [],
    attemptCount: 0,
    occurredAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
