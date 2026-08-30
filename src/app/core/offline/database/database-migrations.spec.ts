import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { OutboxEntry } from '../models/outbox-entry';
import {
  DATABASE_MIGRATIONS,
  DatabaseMigration,
  runDatabaseMigrations,
} from './database-migrations';
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  OFFLINE_DATABASE_SCHEMA,
  OUTBOX_STORE,
  SYNC_RECEIPTS_STORE,
} from './database-schema';

describe('database migrations', () => {
  it('mantém syncReceipts no schema atual com índices de owner, expiração e agregado', async () => {
    const database = await openDatabase(new IDBFactory(), DATABASE_VERSION, DATABASE_MIGRATIONS);
    const store = database.transaction(SYNC_RECEIPTS_STORE).objectStore(SYNC_RECEIPTS_STORE);

    expect(DATABASE_VERSION).toBe(5);
    expect([...database.objectStoreNames]).toEqual(['localRecords', 'outbox', 'syncReceipts']);
    expect([...store.indexNames]).toEqual([
      'ownerAggregate',
      'ownerArchivedAt',
      'ownerExpiresAt',
      'ownerId',
    ]);
    database.close();
  });

  it('preserva stores v3 e adiciona syncReceipts no upgrade', async () => {
    const factory = new IDBFactory();
    const versionThree = await openDatabase(factory, 3, DATABASE_MIGRATIONS.slice(0, 3));
    await addAndComplete(versionThree, OUTBOX_STORE, pendingFixture('ERROR'));
    versionThree.close();

    const versionFour = await openDatabase(factory, 4, DATABASE_MIGRATIONS);

    expect(
      await requestResult(
        versionFour.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll(),
      ),
    ).toHaveLength(1);
    expect(versionFour.objectStoreNames.contains(SYNC_RECEIPTS_STORE)).toBe(true);
    versionFour.close();
  });

  it('terminaliza rejeições funcionais antigas sem terminalizar falhas transitórias', async () => {
    const factory = new IDBFactory();
    const versionFour = await openDatabase(factory, 4, DATABASE_MIGRATIONS.slice(0, 4));
    const rejected = {
      ...pendingFixture('ERROR', 0),
      lastError: {
        code: 'DATASUL_COMMAND_REJECTED',
        category: 'VALIDATION' as const,
        userMessage: 'Motivo de refugo inválido.',
      },
    };
    const transient = {
      ...pendingFixture('RETRY_WAIT', 1),
      nextAttemptAt: '2026-07-28T15:01:00.000Z',
      lastError: {
        code: 'NETWORK',
        category: 'TRANSIENT' as const,
        userMessage: 'Serviço temporariamente indisponível.',
      },
    };
    await addAndComplete(versionFour, OUTBOX_STORE, rejected);
    await addAndComplete(versionFour, OUTBOX_STORE, transient);
    versionFour.close();

    const upgraded = await openDatabase(factory, DATABASE_VERSION, DATABASE_MIGRATIONS);
    const entries = await requestResult<OutboxEntry[]>(
      upgraded.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll(),
    );

    expect(entries.find(entry => entry.localId === rejected.localId)).toMatchObject({
      status: 'ERROR',
      deliveryDisposition: 'REJECTED',
      lastError: rejected.lastError,
    });
    expect(entries.find(entry => entry.localId === transient.localId)).toMatchObject({
      status: 'RETRY_WAIT',
      lastError: transient.lastError,
    });
    expect(entries.find(entry => entry.localId === transient.localId))
      .not.toHaveProperty('deliveryDisposition');
    upgraded.close();
  });

  it('cria o schema 0 -> target com stores, key paths e índices obrigatórios', async () => {
    const database = await openDatabase(new IDBFactory(), DATABASE_VERSION, DATABASE_MIGRATIONS);

    expect(database.name).toBe(DATABASE_NAME);
    expect([...database.objectStoreNames]).toEqual(['localRecords', 'outbox', 'syncReceipts']);

    for (const storeSchema of OFFLINE_DATABASE_SCHEMA.stores) {
      const transaction = database.transaction(storeSchema.name, 'readonly');
      const store = transaction.objectStore(storeSchema.name);
      expect(store.keyPath).toBe(storeSchema.keyPath);
      expect([...store.indexNames]).toEqual(storeSchema.indexes.map((index) => index.name).sort());
      for (const indexSchema of storeSchema.indexes) {
        const index = store.index(indexSchema.name);
        expect(index.keyPath).toEqual(indexSchema.keyPath);
        expect(index.unique).toBe(indexSchema.unique);
      }
    }
    database.close();
  });

  it('executa 1 -> target e preserva entradas em todos os estados sem alterar conteúdo', async () => {
    const factory = new IDBFactory();
    const versionOne = await openDatabase(factory, 1, [DATABASE_MIGRATIONS[0]]);
    const fixtures = [
      'PENDING',
      'SYNCING',
      'RETRY_WAIT',
      'SYNCED',
      'BLOCKED_AUTH',
      'BLOCKED_DEPENDENCY',
      'ERROR',
    ].map((status, index) => pendingFixture(status, index));
    for (const fixture of fixtures) {
      await addAndComplete(versionOne, OUTBOX_STORE, fixture);
    }
    versionOne.close();

    const upgraded = await openDatabase(factory, DATABASE_VERSION, DATABASE_MIGRATIONS);
    const recovered = await requestResult<OutboxEntry[]>(
      upgraded.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll(),
    );

    expect(upgraded.version).toBe(DATABASE_VERSION);
    expect(recovered).toEqual(
      fixtures.map((fixture) =>
        fixture.status === 'SYNCING'
          ? { ...fixture, leaseExpiresAt: '1970-01-01T00:00:00.000Z' }
          : fixture,
      ),
    );
    expect([
      ...upgraded.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).indexNames,
    ]).toEqual(
      expect.arrayContaining([
        'ownerStatusDue',
        'ownerAggregateOrder',
        'ownerOccurredAtLocalId',
      ]),
    );
    upgraded.close();
  });

  it('mantém o snapshot v1 independente e aplica a etapa seguinte em instalação nova', async () => {
    const database = await openDatabase(new IDBFactory(), DATABASE_VERSION, DATABASE_MIGRATIONS);

    expect(database.objectStoreNames.contains('localRecords')).toBe(true);
    expect(database.objectStoreNames.contains('outbox')).toBe(true);
    expect(database.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).indexNames).toContain(
      'ownerAggregateOrder',
    );
    database.close();
  });
});

function openDatabase(
  factory: IDBFactory,
  version: number,
  migrations: readonly DatabaseMigration[],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, version);
    request.onupgradeneeded = (event) => {
      runDatabaseMigrations({
        database: request.result,
        transaction: request.transaction!,
        oldVersion: event.oldVersion,
        targetVersion: version,
        migrations,
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function addAndComplete(database: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).add(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function pendingFixture(status = 'PENDING', index = 0): OutboxEntry<{ readonly quantity: number }> {
  const localId = `123e4567-e89b-42d3-a456-42661417400${index}`;
  return {
    localId,
    idempotencyKey: localId,
    payloadSchemaVersion: 1,
    aggregateType: 'REPORT',
    aggregateId: 'OP-1',
    commandType: 'CONFIRM_REPORT',
    payload: { quantity: 5 },
    canonicalPayload: '{"quantity":5}',
    payloadHash: 'hash',
    ownerId: 'operator-1',
    status: status as OutboxEntry['status'],
    dependencyIds: [],
    attemptCount: 0,
    occurredAt: '2026-07-28T15:00:00.000Z',
    createdAt: '2026-07-28T15:00:00.000Z',
    updatedAt: '2026-07-28T15:00:00.000Z',
  };
}
