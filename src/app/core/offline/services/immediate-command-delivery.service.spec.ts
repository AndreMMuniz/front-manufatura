import { describe, expect, it, vi } from 'vitest';

import { OfflineStorageError } from '../models/offline-storage-error';
import {
  OutboxEntry,
  PersistedSyncError,
  RemoteCommandReceipt,
} from '../models/outbox-entry';
import { SyncSchedulerConfig } from '../models/sync-error';
import { TimeoutScheduler } from './sync-transport';
import { ImmediateCommandDeliveryService } from './immediate-command-delivery.service';

const entry: OutboxEntry = {
  localId: 'local-1',
  idempotencyKey: 'key-1',
  payloadSchemaVersion: 1,
  aggregateType: 'OPERATION',
  aggregateId: 'operation-1',
  commandType: 'REPORT_OPERATION',
  payload: {},
  canonicalPayload: '{}',
  payloadHash: 'hash',
  ownerId: 'operator-1',
  status: 'PENDING',
  dependencyIds: [],
  attemptCount: 0,
  occurredAt: '2026-08-28T12:00:00.000Z',
  createdAt: '2026-08-28T12:00:00.000Z',
  updatedAt: '2026-08-28T12:00:00.000Z',
};

const receipt: RemoteCommandReceipt = {
  serverRecordId: 'remote-1',
  receivedAt: '2026-08-28T12:00:01.000Z',
  processedAt: '2026-08-28T12:00:02.000Z',
  duplicate: false,
};

const persistedError: PersistedSyncError = {
  code: 'INVALID_REPORT',
  category: 'VALIDATION',
  userMessage: 'O reporte foi rejeitado.',
};

describe('ImmediateCommandDeliveryService', () => {
  it.each([
    ['SYNCED', { status: 'SYNCED', receipt }],
    ['RETRY_WAIT', { status: 'PENDING' }],
    ['BLOCKED_AUTH', { status: 'PENDING' }],
    ['ERROR', { status: 'ERROR', error: persistedError }],
  ] as const)('classifica %s depois do ciclo', async (status, expected) => {
    const coordinator = { requestSync: vi.fn().mockResolvedValue(undefined) };
    const outbox = {
      getById: vi.fn().mockResolvedValue({
        ...entry,
        status,
        ...(status === 'SYNCED' ? { receipt } : {}),
        ...(status === 'ERROR' ? { lastError: persistedError } : {}),
      }),
    };
    const service = createService(coordinator, outbox);

    await expect(service.deliver(entry.localId)).resolves.toEqual(expected);
    expect(coordinator.requestSync).toHaveBeenCalledOnce();
    expect(outbox.getById).toHaveBeenCalledWith('operator-1', entry.localId);
  });

  it.each(['PENDING', 'SYNCING', 'BLOCKED_DEPENDENCY'] as const)(
    'mantém %s como PENDING',
    async (status) => {
      const service = createService(
        { requestSync: vi.fn().mockResolvedValue(undefined) },
        { getById: vi.fn().mockResolvedValue({ ...entry, status }) },
      );

      await expect(service.deliver(entry.localId)).resolves.toEqual({ status: 'PENDING' });
    },
  );

  it('devolve PENDING no limite sem cancelar o requestSync em andamento', async () => {
    let scheduledCallback: (() => void) | undefined;
    const cancelScheduledTimeout = vi.fn();
    const coordinator = { requestSync: vi.fn(() => new Promise<void>(() => undefined)) };
    const outbox = { getById: vi.fn().mockResolvedValue({ ...entry, status: 'SYNCING' }) };
    const service = createService(coordinator, outbox, {
      schedule: vi.fn((callback) => {
        scheduledCallback = callback;
        return cancelScheduledTimeout;
      }),
    });

    const delivery = service.deliver(entry.localId);
    scheduledCallback?.();

    await expect(delivery).resolves.toEqual({ status: 'PENDING' });
    expect(cancelScheduledTimeout).not.toHaveBeenCalled();
    expect(outbox.getById).toHaveBeenCalledWith('operator-1', entry.localId);
  });

  it('observa o estado persistido quando o ciclo encerra com erro', async () => {
    const service = createService(
      { requestSync: vi.fn().mockRejectedValue(new Error('cycle failed')) },
      { getById: vi.fn().mockResolvedValue({ ...entry, status: 'RETRY_WAIT' }) },
    );

    await expect(service.deliver(entry.localId)).resolves.toEqual({ status: 'PENDING' });
  });

  it('falha antes da Outbox quando a sessão encerra durante o ciclo', async () => {
    let resolveCycle!: () => void;
    let currentUser: { readonly id: string } | null = { id: 'operator-1' };
    const coordinator = {
      requestSync: vi.fn(() => new Promise<void>((resolve) => { resolveCycle = resolve; })),
    };
    const outbox = { getById: vi.fn() };
    const service = createService(coordinator, outbox, undefined, {
      get currentUser() {
        return currentUser;
      },
    });

    const delivery = service.deliver(entry.localId);
    currentUser = null;
    resolveCycle();

    await expect(delivery).rejects.toMatchObject({
      name: 'OfflineStorageError',
      code: 'PAYLOAD_INVALID',
    } satisfies Partial<OfflineStorageError>);
    expect(outbox.getById).not.toHaveBeenCalled();
  });

  it('falha antes da Outbox quando outro owner assume a sessão durante o ciclo', async () => {
    let resolveCycle!: () => void;
    let currentUser: { readonly id: string } | null = { id: 'operator-1' };
    const coordinator = {
      requestSync: vi.fn(() => new Promise<void>((resolve) => { resolveCycle = resolve; })),
    };
    const outbox = { getById: vi.fn() };
    const service = createService(coordinator, outbox, undefined, {
      get currentUser() {
        return currentUser;
      },
    });

    const delivery = service.deliver(entry.localId);
    currentUser = { id: 'operator-2' };
    resolveCycle();

    await expect(delivery).rejects.toMatchObject({
      name: 'OfflineStorageError',
      code: 'PAYLOAD_INVALID',
    } satisfies Partial<OfflineStorageError>);
    expect(outbox.getById).not.toHaveBeenCalled();
  });

  it('falha como armazenamento quando não há owner autenticado', async () => {
    const coordinator = { requestSync: vi.fn() };
    const outbox = { getById: vi.fn() };
    const service = createService(coordinator, outbox, undefined, { currentUser: null });

    await expect(service.deliver(entry.localId)).rejects.toMatchObject({
      name: 'OfflineStorageError',
      code: 'PAYLOAD_INVALID',
    } satisfies Partial<OfflineStorageError>);
    expect(coordinator.requestSync).not.toHaveBeenCalled();
    expect(outbox.getById).not.toHaveBeenCalled();
  });

  it('falha como armazenamento quando a entrada não é encontrada para o owner', async () => {
    const service = createService(
      { requestSync: vi.fn().mockResolvedValue(undefined) },
      { getById: vi.fn().mockResolvedValue(null) },
    );

    await expect(service.deliver(entry.localId)).rejects.toMatchObject({
      name: 'OfflineStorageError',
      code: 'CONFLICT',
    } satisfies Partial<OfflineStorageError>);
  });
});

function createService(
  coordinator: { readonly requestSync: () => Promise<void> },
  outbox: { readonly getById: (ownerId: string, localId: string) => Promise<OutboxEntry | null> },
  scheduler: TimeoutScheduler = immediateScheduler(),
  authSession: { readonly currentUser: { readonly id: string } | null } = {
    currentUser: { id: 'operator-1' },
  },
): ImmediateCommandDeliveryService {
  return new ImmediateCommandDeliveryService(
    coordinator as never,
    outbox as never,
    authSession as never,
    schedulerConfig(),
    scheduler,
  );
}

function immediateScheduler(): TimeoutScheduler {
  return { schedule: vi.fn(() => () => undefined) };
}

function schedulerConfig(): SyncSchedulerConfig {
  return {
    baseDelayMs: 1,
    maxDelayMs: 1,
    requestTimeoutMs: 30_000,
    leaseDurationMs: 60_000,
    intervalMs: 30_000,
    batchSize: 1,
    concurrency: 1,
  };
}
