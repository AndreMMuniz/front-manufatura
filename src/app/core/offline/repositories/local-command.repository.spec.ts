import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from '../database/offline-database';
import { OUTBOX_STORE } from '../database/database-schema';
import { OfflineStorageError } from '../models/offline-storage-error';
import { IdempotencyService } from '../services/idempotency.service';
import { PayloadIntegrityService } from '../services/payload-integrity.service';
import { OutboxActivityService } from '../services/outbox-activity.service';
import { LocalCommandRepository } from './local-command.repository';
import { LocalRecordRepository } from './local-record.repository';
import { OutboxRepository } from './outbox.repository';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_COMMAND_ID = '223e4567-e89b-42d3-a456-426614174000';
const NOW = '2026-07-28T16:00:00.000Z';

describe('LocalCommandRepository', () => {
  let factory: IDBFactory;
  let database: OfflineDatabase;
  let commands: LocalCommandRepository;
  let localRecords: LocalRecordRepository;
  let outbox: OutboxRepository;
  let activity: OutboxActivityService;

  beforeEach(() => {
    factory = new IDBFactory();
    database = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    localRecords = new LocalRecordRepository(database);
    outbox = new OutboxRepository(database);
    activity = { publish: vi.fn() } as unknown as OutboxActivityService;
    const randomUUID = vi.fn()
      .mockReturnValueOnce(
        COMMAND_ID as `${string}-${string}-${string}-${string}-${string}`,
      )
      .mockReturnValue(
        OTHER_COMMAND_ID as `${string}-${string}-${string}-${string}-${string}`,
      );
    commands = new LocalCommandRepository(
      database,
      new IdempotencyService(() => ({ randomUUID })),
      new PayloadIntegrityService(() => globalThis.crypto.subtle),
      () => new Date(NOW),
      activity,
    );
  });

  it('commita exatamente 1 registro + 1 Outbox e retorna somente o snapshot defensivo', async () => {
    const payload = { quantity: 5, measuredAt: new Date('2026-07-28T15:30:00.000Z') };
    const result = await commands.persistConfirmedCommand(request(payload));

    expect(result).toMatchObject({
      localId: COMMAND_ID,
      idempotencyKey: COMMAND_ID,
      committedAt: NOW,
      localRecord: {
        databaseVersion: 3,
        ownerId: 'operator-1',
        payloadSchemaVersion: 2,
      },
      outboxEntry: {
        ownerId: 'operator-1',
        status: 'PENDING',
        attemptCount: 0,
        dependencyIds: ['prior-command'],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(1);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
    expect(activity.publish).toHaveBeenCalledOnce();
  });

  it('permite captura atômica inicialmente bloqueada por autorização sem persistir prova', async () => {
    const result = await commands.persistConfirmedCommand(
      request(
        { approvalStatus: 'PENDING' },
        {
          initialSyncStatus: 'BLOCKED_AUTH',
          initialAuthBlockReason: 'SUPERVISOR',
        },
      ),
    );

    expect(result.outboxEntry.status).toBe('BLOCKED_AUTH');
    expect(JSON.stringify(result)).not.toMatch(/password|senha|credential|token|proof/i);
  });

  it('repete chave + hash iguais de forma idempotente sem criar novas linhas', async () => {
    const first = await commands.persistConfirmedCommand(request({ quantity: 5 }));
    const repeated = await commands.persistConfirmedCommand(
      request({ quantity: 5 }, { idempotencyKey: COMMAND_ID }),
    );

    expect(repeated).toEqual(first);
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(1);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
  });

  it('mantém replay idempotente depois que o estado mutável da Outbox avança', async () => {
    await commands.persistConfirmedCommand(
      request({ quantity: 5 }, { dependencyIds: [] }),
    );
    await outbox.claim({
      ownerId: 'operator-1',
      localId: COMMAND_ID,
      leaseToken: 'lease-replay',
      now: NOW,
      leaseExpiresAt: '2026-07-28T16:01:00.000Z',
    });

    const replayed = await commands.persistConfirmedCommand(
      request(
        { quantity: 5 },
        { idempotencyKey: COMMAND_ID, dependencyIds: [] },
      ),
    );

    expect(replayed.outboxEntry.status).toBe('SYNCING');
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(1);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
  });

  it.each([
    {
      initialSyncStatus: 'PENDING' as const,
      initialAuthBlockReason: 'SESSION' as const,
    },
    {
      initialSyncStatus: 'BLOCKED_AUTH' as const,
      initialAuthBlockReason: undefined,
    },
  ])('rejeita estado e motivo inicial incompatíveis: %o', async (overrides) => {
    const createTransaction = vi.spyOn(database, 'createTransaction');

    await expect(
      commands.persistConfirmedCommand(request({ quantity: 5 }, overrides)),
    ).rejects.toEqual(expect.objectContaining({ code: 'PAYLOAD_INVALID' }));
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('reutiliza occurredAt persistido quando a repetição idempotente omite a data', async () => {
    let current = new Date(NOW);
    const isolated = new LocalCommandRepository(
      database,
      new IdempotencyService(() => ({
        randomUUID: () =>
          COMMAND_ID as `${string}-${string}-${string}-${string}-${string}`,
      })),
      new PayloadIntegrityService(() => globalThis.crypto.subtle),
      () => current,
    );
    const first = await isolated.persistConfirmedCommand(
      request({ quantity: 5 }, { occurredAt: undefined }),
    );
    current = new Date('2026-07-28T17:00:00.000Z');
    const repeated = await isolated.persistConfirmedCommand(
      request(
        { quantity: 5 },
        { idempotencyKey: COMMAND_ID, occurredAt: undefined },
      ),
    );

    expect(repeated).toEqual(first);
    expect(repeated.localRecord.occurredAt).toBe(NOW);
  });

  it('normaliza UUIDs de dependência para a identidade canônica minúscula', async () => {
    const result = await commands.persistConfirmedCommand(
      request(
        { quantity: 5 },
        { dependencyIds: [OTHER_COMMAND_ID.toUpperCase()] },
      ),
    );

    expect(result.outboxEntry.dependencyIds).toEqual([OTHER_COMMAND_ID]);
  });

  it('rejeita chave igual com hash divergente sem mutar os stores', async () => {
    await commands.persistConfirmedCommand(request({ quantity: 5 }));

    await expect(
      commands.persistConfirmedCommand(
        request({ quantity: 6 }, { idempotencyKey: COMMAND_ID }),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'CONFLICT' }));
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(1);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
  });

  it.each([
    { aggregateType: 'SCRAP_REPORT' },
    { aggregateId: 'OP-99' },
    { commandType: 'CANCEL_REPORT' },
    { payloadSchemaVersion: 3 },
    { dependencyIds: ['another-command'] },
    { occurredAt: '2026-07-28T15:46:00.000Z' },
    { businessStatus: 'CONFIRMED' },
    {
      initialSyncStatus: 'BLOCKED_AUTH' as const,
      initialAuthBlockReason: 'SUPERVISOR' as const,
    },
  ])('rejeita chave e payload iguais quando o envelope diverge: %o', async (overrides) => {
    await commands.persistConfirmedCommand(request({ quantity: 5 }));

    await expect(
      commands.persistConfirmedCommand(
        request({ quantity: 5 }, { idempotencyKey: COMMAND_ID, ...overrides }),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('aborta 0+0 quando a segunda escrita falha', async () => {
    await seedOutboxCollision(database);

    await expect(commands.persistConfirmedCommand(request({ quantity: 5 }))).rejects.toBeInstanceOf(
      OfflineStorageError,
    );
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(0);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
  });

  it('supersede o par ERROR atomicamente com novo UUID, posição lógica e dependências herdadas', async () => {
    const original = await commands.persistConfirmedCommand(request({ quantity: 5 }));
    await forceOutboxError(database, original.localId);
    const originalIdentity = identity(original.outboxEntry);

    const replacement = await commands.persistSupersedingCommand({
      ownerId: 'operator-1',
      actorId: ' operator-1 ',
      originalLocalId: original.localId,
      command: request({ quantity: 6 }, {
        idempotencyKey: undefined,
        dependencyIds: ['ignored-new-dependency'],
      }),
    });

    expect(replacement.localId).toBe(OTHER_COMMAND_ID);
    expect(replacement.outboxEntry).toMatchObject({
      deliveryDisposition: 'ACTIVE',
      supersedesLocalId: COMMAND_ID,
      logicalOccurredAt: original.outboxEntry.occurredAt,
      dependencyIds: ['prior-command'],
    });
    expect(await localRecords.getById('operator-1', COMMAND_ID)).toMatchObject({
      deliveryDisposition: 'SUPERSEDED',
      supersededByLocalId: OTHER_COMMAND_ID,
      supersededBy: 'operator-1',
    });
    const superseded = await outbox.getById('operator-1', COMMAND_ID);
    expect(superseded).toMatchObject({
      status: 'ERROR',
      deliveryDisposition: 'SUPERSEDED',
      supersededByLocalId: OTHER_COMMAND_ID,
    });
    expect(identity(superseded!)).toEqual(originalIdentity);
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(2);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(2);
  });

  it('permite um único vencedor em race de supersessão', async () => {
    const original = await commands.persistConfirmedCommand(request({ quantity: 5 }));
    await forceOutboxError(database, original.localId);

    const results = await Promise.allSettled([
      commands.persistSupersedingCommand({
        ownerId: 'operator-1',
        actorId: 'operator-1',
        originalLocalId: original.localId,
        command: request({ quantity: 6 }),
      }),
      commands.persistSupersedingCommand({
        ownerId: 'operator-1',
        actorId: 'operator-1',
        originalLocalId: original.localId,
        command: request({ quantity: 7 }),
      }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(2);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(2);
  });

  it('rejeita substituto de outro tipo, agregado ou schema', async () => {
    const original = await commands.persistConfirmedCommand(request({ quantity: 5 }));
    await forceOutboxError(database, original.localId);

    await expect(commands.persistSupersedingCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      originalLocalId: original.localId,
      command: request({ quantity: 6 }, {
        commandType: 'OTHER_COMMAND',
        aggregateId: 'OTHER_AGGREGATE',
        payloadSchemaVersion: 3,
      }),
    })).rejects.toEqual(expect.objectContaining({ code: 'CONFLICT' }));
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
  });

  it('abandona os dois envelopes atomicamente sem excluir histórico', async () => {
    const original = await commands.persistConfirmedCommand(request({ quantity: 5 }));

    expect(await commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId: original.localId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: true,
      reason: 'Registro duplicado confirmado na operação',
      now: NOW,
      sessionIsCurrent: () => true,
    })).toBe('abandoned');

    expect(await localRecords.getById('operator-1', original.localId)).toMatchObject({
      deliveryDisposition: 'ABANDONED',
      abandonedAt: NOW,
      abandonedBy: 'operator-1',
      abandonReason: 'Registro duplicado confirmado na operação',
      abandonPermission: 'SYNC_UNSYNCHRONIZED_ABANDON',
    });
    expect(await outbox.getById('operator-1', original.localId)).toMatchObject({
      deliveryDisposition: 'ABANDONED',
      status: 'PENDING',
    });
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(1);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
  });

  it('nega abandono sem permissão/sessão e bloqueia dependentes ou cauda ativa', async () => {
    const target = await commands.persistConfirmedCommand(
      request({ quantity: 5 }, { aggregateId: 'TARGET' }),
    );
    const denied = await commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId: target.localId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: false,
      reason: 'Justificativa operacional válida',
      now: NOW,
      sessionIsCurrent: () => true,
    });
    expect(denied).toBe('denied');

    await seedCommandPair(database, {
      ...target.localRecord,
      localId: OTHER_COMMAND_ID,
      idempotencyKey: OTHER_COMMAND_ID,
      aggregateType: 'OTHER',
      aggregateId: 'DEPENDENT',
      dependencyIds: [target.localId],
    }, {
      ...target.outboxEntry,
      localId: OTHER_COMMAND_ID,
      idempotencyKey: OTHER_COMMAND_ID,
      aggregateType: 'OTHER',
      aggregateId: 'DEPENDENT',
      dependencyIds: [target.localId],
    });
    expect(await commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId: target.localId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: true,
      reason: 'Justificativa operacional válida',
      now: NOW,
      sessionIsCurrent: () => true,
    })).toBe('has-dependents');

    expect(await commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId: target.localId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: true,
      reason: 'Justificativa operacional válida',
      now: NOW,
      sessionIsCurrent: () => false,
    })).toBe('stale-or-ineligible');
  });

  it('permite abandonar do dependente ao antecessor quando compartilham o instante lógico', async () => {
    const report = await commands.persistConfirmedCommand(request(
      { quantity: 5 },
      {
        idempotencyKey: OTHER_COMMAND_ID,
        commandType: 'REPORT_OPERATION',
        dependencyIds: [],
      },
    ));
    const end = await commands.persistConfirmedCommand(request(
      {},
      {
        idempotencyKey: COMMAND_ID,
        commandType: 'END_OPERATION',
        dependencyIds: [report.localId],
      },
    ));
    const abandon = (localId: string) => commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: true,
      reason: 'Fila local não deve mais ser enviada',
      now: NOW,
      sessionIsCurrent: () => true,
    });

    expect(await abandon(end.localId)).toBe('abandoned');
    expect(await abandon(report.localId)).toBe('abandoned');
  });

  it('bloqueia abandono por dependente ancestral e por cauda no mesmo instante lógico', async () => {
    const original = await commands.persistConfirmedCommand(
      request({ quantity: 5 }, { aggregateId: 'TARGET', dependencyIds: [] }),
    );
    await forceOutboxError(database, original.localId);
    const replacement = await commands.persistSupersedingCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      originalLocalId: original.localId,
      command: request({ quantity: 6 }, { aggregateId: 'TARGET', dependencyIds: [] }),
    });
    const dependentId = '323e4567-e89b-42d3-a456-426614174000';
    await seedCommandPair(database, {
      ...replacement.localRecord,
      localId: dependentId,
      idempotencyKey: dependentId,
      aggregateId: 'DEPENDENT',
      dependencyIds: [original.localId],
      supersedesLocalId: undefined,
    }, {
      ...replacement.outboxEntry,
      localId: dependentId,
      idempotencyKey: dependentId,
      aggregateId: 'DEPENDENT',
      dependencyIds: [original.localId],
      supersedesLocalId: undefined,
    });

    expect(await commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId: replacement.localId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: true,
      reason: 'Justificativa operacional válida',
      now: NOW,
      sessionIsCurrent: () => true,
    })).toBe('has-dependents');

    const sameTimeTargetId = '423e4567-e89b-42d3-a456-426614174000';
    const sameTimeTailId = '523e4567-e89b-42d3-a456-426614174000';
    await seedCommandPair(database, {
      ...replacement.localRecord,
      localId: sameTimeTargetId,
      idempotencyKey: sameTimeTargetId,
      aggregateId: 'SAME-TIME',
      dependencyIds: [],
      supersedesLocalId: undefined,
    }, {
      ...replacement.outboxEntry,
      localId: sameTimeTargetId,
      idempotencyKey: sameTimeTargetId,
      aggregateId: 'SAME-TIME',
      dependencyIds: [],
      supersedesLocalId: undefined,
    });
    await seedCommandPair(database, {
      ...replacement.localRecord,
      localId: sameTimeTailId,
      idempotencyKey: sameTimeTailId,
      aggregateId: 'SAME-TIME',
      dependencyIds: [],
      supersedesLocalId: undefined,
    }, {
      ...replacement.outboxEntry,
      localId: sameTimeTailId,
      idempotencyKey: sameTimeTailId,
      aggregateId: 'SAME-TIME',
      dependencyIds: [],
      supersedesLocalId: undefined,
    });
    expect(await commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId: sameTimeTargetId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: true,
      reason: 'Justificativa operacional válida',
      now: NOW,
      sessionIsCurrent: () => true,
    })).toBe('has-later-commands');
  });

  it('aborta abandono quando a sessão muda antes do commit', async () => {
    const original = await commands.persistConfirmedCommand(request({ quantity: 5 }));
    let current = true;

    expect(await commands.abandonCommand({
      ownerId: 'operator-1',
      actorId: 'operator-1',
      localId: original.localId,
      permission: 'SYNC_UNSYNCHRONIZED_ABANDON',
      authorized: true,
      reason: 'Justificativa operacional válida',
      now: NOW,
      sessionIsCurrent: () => current,
      watchSession: listener => {
        current = false;
        listener();
        return () => undefined;
      },
    })).toBe('stale-or-ineligible');
    expect(await outbox.getById('operator-1', original.localId)).toMatchObject({
      deliveryDisposition: 'ACTIVE',
    });
  });

  it('não retorna registros de outro proprietário pelas APIs públicas', async () => {
    await commands.persistConfirmedCommand(request({ quantity: 5 }));

    expect(await localRecords.listByOwner('operator-2')).toEqual([]);
    expect(await localRecords.getById('operator-2', COMMAND_ID)).toBeNull();
    expect(await outbox.listByOwner('operator-2')).toEqual([]);
    expect(await outbox.getById('operator-2', COMMAND_ID)).toBeNull();
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(1);
  });

  it('recupera PENDING, datas e payload ao fechar e recriar toda a camada', async () => {
    const persisted = await commands.persistConfirmedCommand(request({ quantity: 5 }));
    database.close();

    const reopenedDatabase = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    const reopenedRecords = new LocalRecordRepository(reopenedDatabase);
    const reopenedOutbox = new OutboxRepository(reopenedDatabase);

    expect(await reopenedRecords.getById('operator-1', persisted.localId)).toEqual(
      persisted.localRecord,
    );
    expect(await reopenedOutbox.getById('operator-1', persisted.localId)).toEqual(
      persisted.outboxEntry,
    );
    expect((await reopenedOutbox.getById('operator-1', persisted.localId))?.status).toBe('PENDING');
  });

  it('valida owner e metadados antes de abrir a transação', async () => {
    const createTransaction = vi.spyOn(database, 'createTransaction');

    await expect(
      commands.persistConfirmedCommand(request({ quantity: 5 }, { ownerId: '  ' })),
    ).rejects.toEqual(expect.objectContaining({ code: 'PAYLOAD_INVALID' }));
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('captura o envelope antes do await de integridade', async () => {
    let releasePrepare!: () => void;
    const waitForRelease = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    const integrity = new PayloadIntegrityService(() => globalThis.crypto.subtle);
    vi.spyOn(integrity, 'prepare').mockImplementation(async () => {
      await waitForRelease;
      return {
        snapshot: { quantity: 5 },
        canonicalPayload: '{"quantity":5}',
        payloadHash: 'stable-hash',
      };
    });
    const isolated = new LocalCommandRepository(
      database,
      new IdempotencyService(() => ({
        randomUUID: () =>
          COMMAND_ID as `${string}-${string}-${string}-${string}-${string}`,
      })),
      integrity,
      () => new Date(NOW),
    );
    const mutable = request({ quantity: 5 }) as ReturnType<typeof request> & {
      aggregateId: string;
      payloadSchemaVersion: number;
    };

    const pending = isolated.persistConfirmedCommand(mutable);
    mutable.aggregateId = 'MUTATED';
    mutable.payloadSchemaVersion = 0;
    releasePrepare();

    await expect(pending).resolves.toMatchObject({
      localRecord: { aggregateId: 'OP-42', payloadSchemaVersion: 2 },
      outboxEntry: { aggregateId: 'OP-42', payloadSchemaVersion: 2 },
    });
  });

  it('rejeita dependência própria e occurredAt vazio antes de abrir a transação', async () => {
    const createTransaction = vi.spyOn(database, 'createTransaction');

    await expect(
      commands.persistConfirmedCommand(
        request({ quantity: 5 }, { dependencyIds: [COMMAND_ID] }),
      ),
    ).rejects.toEqual(expect.objectContaining({ code: 'PAYLOAD_INVALID' }));
    await expect(
      commands.persistConfirmedCommand(request({ quantity: 5 }, { occurredAt: '' })),
    ).rejects.toEqual(expect.objectContaining({ code: 'PAYLOAD_INVALID' }));
    expect(createTransaction).not.toHaveBeenCalled();
  });
});

function request(
  payload: unknown,
  overrides: Partial<Parameters<LocalCommandRepository['persistConfirmedCommand']>[0]> = {},
) {
  return {
    ownerId: 'operator-1',
    aggregateType: 'PRODUCTION_REPORT',
    aggregateId: 'OP-42',
    commandType: 'CONFIRM_REPORT',
    payload,
    payloadSchemaVersion: 2,
    dependencyIds: [' prior-command ', '', 'prior-command'],
    occurredAt: '2026-07-28T15:45:00.000Z',
    ...overrides,
  };
}

async function seedOutboxCollision(database: OfflineDatabase): Promise<void> {
  const transaction = await database.createTransaction([OUTBOX_STORE], 'readwrite');
  const completion = complete(transaction);
  transaction.objectStore(OUTBOX_STORE).add({
    localId: COMMAND_ID,
    idempotencyKey: OTHER_COMMAND_ID,
    ownerId: 'operator-1',
    status: 'PENDING',
    createdAt: NOW,
  });
  await completion;
}

async function forceOutboxError(database: OfflineDatabase, localId: string): Promise<void> {
  const transaction = await database.createTransaction([OUTBOX_STORE], 'readwrite');
  const completion = complete(transaction);
  const store = transaction.objectStore(OUTBOX_STORE);
  const current = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const get = store.get(localId);
    get.onsuccess = () => resolve(get.result as Record<string, unknown>);
    get.onerror = () => reject(get.error);
  });
  store.put({
    ...current,
    status: 'ERROR',
    lastError: {
      code: 'VALIDATION',
      category: 'VALIDATION',
      userMessage: 'Corrija os dados.',
    },
  });
  await completion;
}

async function seedCommandPair(
  database: OfflineDatabase,
  localRecord: object,
  outboxEntry: object,
): Promise<void> {
  const transaction = await database.createTransaction(
    ['localRecords', OUTBOX_STORE],
    'readwrite',
  );
  const completion = complete(transaction);
  transaction.objectStore('localRecords').add(localRecord);
  transaction.objectStore(OUTBOX_STORE).add(outboxEntry);
  await completion;
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function identity(entry: {
  readonly idempotencyKey: string;
  readonly canonicalPayload: string;
  readonly payload: unknown;
  readonly payloadHash: string;
}) {
  return {
    idempotencyKey: entry.idempotencyKey,
    canonicalPayload: entry.canonicalPayload,
    payload: entry.payload,
    payloadHash: entry.payloadHash,
  };
}
