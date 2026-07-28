import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from '../database/offline-database';
import { OUTBOX_STORE } from '../database/database-schema';
import { OfflineStorageError } from '../models/offline-storage-error';
import { IdempotencyService } from '../services/idempotency.service';
import { PayloadIntegrityService } from '../services/payload-integrity.service';
import { LocalCommandRepository } from './local-command.repository';
import { LocalRecordRepository } from './local-record.repository';
import { OutboxRepository } from './outbox.repository';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = '2026-07-28T16:00:00.000Z';

describe('LocalCommandRepository', () => {
  let factory: IDBFactory;
  let database: OfflineDatabase;
  let commands: LocalCommandRepository;
  let localRecords: LocalRecordRepository;
  let outbox: OutboxRepository;

  beforeEach(() => {
    factory = new IDBFactory();
    database = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    localRecords = new LocalRecordRepository(database);
    outbox = new OutboxRepository(database);
    commands = new LocalCommandRepository(
      database,
      new IdempotencyService(() => ({
        randomUUID: vi.fn(
          () => COMMAND_ID as `${string}-${string}-${string}-${string}-${string}`,
        ),
      })),
      new PayloadIntegrityService(() => globalThis.crypto.subtle),
      () => new Date(NOW),
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
        databaseVersion: 1,
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

  it('aborta 0+0 quando a segunda escrita falha', async () => {
    await seedOutboxCollision(database);

    await expect(commands.persistConfirmedCommand(request({ quantity: 5 }))).rejects.toBeInstanceOf(
      OfflineStorageError,
    );
    expect(await localRecords.listByOwner('operator-1')).toHaveLength(0);
    expect(await outbox.listByOwner('operator-1')).toHaveLength(1);
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
    idempotencyKey: COMMAND_ID,
    ownerId: 'operator-1',
    status: 'PENDING',
    createdAt: NOW,
  });
  await completion;
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
