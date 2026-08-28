import { describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from '../../auth/auth-session.service';
import { OutboxEntry } from '../models/outbox-entry';
import { OutboxRepository } from '../repositories/outbox.repository';
import { SyncRetentionRepository } from '../repositories/sync-retention.repository';
import { SyncRetentionService } from './sync-retention.service';

const OWNER = 'operator-1';
const OTHER_OWNER = 'operator-2';
const NOW = '2026-08-28T13:00:00.000Z';
const EXPIRES_AT = '2026-09-27T13:00:00.000Z';

describe('SyncRetentionService', () => {
  it('executa a retenção para o owner autenticado normalizado', async () => {
    const outbox = { listByOwner: vi.fn().mockResolvedValue([]) };
    const retention = {
      compactClosedAggregate: vi.fn(),
      pruneReceipts: vi.fn().mockResolvedValue(0),
    };
    const service = createService(outbox, retention, { id: `  ${OWNER}  ` });

    await expect(service.cleanupCurrentOwner()).resolves.toEqual({
      compactedAggregates: 0,
      prunedReceipts: 0,
    });

    expect(outbox.listByOwner).toHaveBeenCalledWith(OWNER);
  });

  it('ignora a retenção quando não existe owner autenticado', async () => {
    const outbox = { listByOwner: vi.fn() };
    const retention = {
      compactClosedAggregate: vi.fn(),
      pruneReceipts: vi.fn(),
    };
    const service = createService(outbox, retention);

    await expect(service.cleanupCurrentOwner()).resolves.toBeNull();

    expect(outbox.listByOwner).not.toHaveBeenCalled();
    expect(retention.pruneReceipts).not.toHaveBeenCalled();
  });

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

  it('limita cada execução aos primeiros 25 agregados encerrados', async () => {
    const outbox = { listByOwner: vi.fn().mockResolvedValue(
      Array.from({ length: 26 }, (_, index) => endEntry(`op-${index + 1}`)),
    ) };
    const retention = {
      compactClosedAggregate: vi.fn().mockResolvedValue('compacted'),
      pruneReceipts: vi.fn().mockResolvedValue(0),
    };
    const service = createService(outbox, retention);

    await expect(service.cleanupOwner(OWNER)).resolves.toEqual({
      compactedAggregates: 25,
      prunedReceipts: 0,
    });

    expect(retention.compactClosedAggregate).toHaveBeenCalledTimes(25);
    expect(retention.compactClosedAggregate).toHaveBeenLastCalledWith(
      OWNER,
      'OPERATION',
      'op-25',
      NOW,
      EXPIRES_AT,
    );
    expect(retention.pruneReceipts).toHaveBeenCalledWith(OWNER, NOW, 500);
  });

  it('compartilha uma única execução concorrente para o mesmo owner', async () => {
    let releaseList: (entries: readonly OutboxEntry[]) => void = () => undefined;
    const pendingList = new Promise<readonly OutboxEntry[]>((resolve) => {
      releaseList = resolve;
    });
    const outbox = { listByOwner: vi.fn().mockReturnValue(pendingList) };
    const retention = {
      compactClosedAggregate: vi.fn(),
      pruneReceipts: vi.fn().mockResolvedValue(0),
    };
    const service = createService(outbox, retention);

    const first = service.cleanupOwner(OWNER);
    const second = service.cleanupOwner(OWNER);

    try {
      expect(outbox.listByOwner).toHaveBeenCalledOnce();
    } finally {
      releaseList([]);
      await Promise.allSettled([first, second]);
    }

    await expect(Promise.all([first, second])).resolves.toEqual([
      { compactedAggregates: 0, prunedReceipts: 0 },
      { compactedAggregates: 0, prunedReceipts: 0 },
    ]);
    expect(retention.pruneReceipts).toHaveBeenCalledOnce();
  });

  it('não bloqueia a retenção de outro owner enquanto uma execução está ativa', async () => {
    let releaseOwner: (entries: readonly OutboxEntry[]) => void = () => undefined;
    const pendingOwner = new Promise<readonly OutboxEntry[]>((resolve) => {
      releaseOwner = resolve;
    });
    const outbox = {
      listByOwner: vi.fn((ownerId: string) =>
        ownerId === OWNER ? pendingOwner : Promise.resolve([])),
    };
    const retention = {
      compactClosedAggregate: vi.fn(),
      pruneReceipts: vi.fn().mockResolvedValue(0),
    };
    const service = createService(outbox, retention);
    const firstOwner = service.cleanupOwner(OWNER);

    try {
      await expect(service.cleanupOwner(OTHER_OWNER)).resolves.toEqual({
        compactedAggregates: 0,
        prunedReceipts: 0,
      });
      expect(retention.pruneReceipts).toHaveBeenCalledWith(OTHER_OWNER, NOW, 500);
    } finally {
      releaseOwner([]);
      await firstOwner;
    }
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
  currentUser: { readonly id: string } | null = null,
): SyncRetentionService {
  return new SyncRetentionService(
    outbox as OutboxRepository,
    retention as SyncRetentionRepository,
    () => new Date(NOW),
    { currentUser } as AuthSessionService,
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
