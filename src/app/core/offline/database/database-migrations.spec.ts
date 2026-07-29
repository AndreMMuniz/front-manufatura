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
} from './database-schema';

describe('database migrations', () => {
  it('cria o schema 0 -> 1 com stores, key paths e índices obrigatórios', async () => {
    const database = await openDatabase(new IDBFactory(), DATABASE_VERSION, DATABASE_MIGRATIONS);

    expect(database.name).toBe(DATABASE_NAME);
    expect([...database.objectStoreNames]).toEqual(['localRecords', 'outbox']);

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

  it('executa 1 -> 2 em ordem e preserva uma pendência existente', async () => {
    const factory = new IDBFactory();
    const versionOne = await openDatabase(factory, 1, DATABASE_MIGRATIONS);
    const pending = pendingFixture();
    await addAndComplete(versionOne, OUTBOX_STORE, pending);
    versionOne.close();

    const testMigration: DatabaseMigration = {
      toVersion: 2,
      migrate: ({ database }) => database.createObjectStore('migrationProbe', { keyPath: 'id' }),
    };
    const versionTwo = await openDatabase(factory, 2, [...DATABASE_MIGRATIONS, testMigration]);
    const recovered = await requestResult<OutboxEntry>(
      versionTwo.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).get(pending.localId),
    );

    expect(versionTwo.objectStoreNames.contains('migrationProbe')).toBe(true);
    expect(recovered).toEqual(pending);
    versionTwo.close();
  });

  it('abre uma instalação nova direto em v2 sem a migration 0 -> 1 antecipar o schema futuro', async () => {
    const futureMigration: DatabaseMigration = {
      toVersion: 2,
      migrate: ({ database }) => database.createObjectStore('futureStore', { keyPath: 'id' }),
    };

    const database = await openDatabase(
      new IDBFactory(),
      2,
      [...DATABASE_MIGRATIONS, futureMigration],
    );

    expect(database.objectStoreNames.contains('futureStore')).toBe(true);
    expect(database.objectStoreNames.contains('localRecords')).toBe(true);
    expect(database.objectStoreNames.contains('outbox')).toBe(true);
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

function pendingFixture(): OutboxEntry<{ readonly quantity: number }> {
  return {
    localId: '123e4567-e89b-42d3-a456-426614174000',
    idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    payloadSchemaVersion: 1,
    aggregateType: 'REPORT',
    aggregateId: 'OP-1',
    commandType: 'CONFIRM_REPORT',
    payload: { quantity: 5 },
    canonicalPayload: '{"quantity":5}',
    payloadHash: 'hash',
    ownerId: 'operator-1',
    status: 'PENDING',
    dependencyIds: [],
    attemptCount: 0,
    occurredAt: '2026-07-28T15:00:00.000Z',
    createdAt: '2026-07-28T15:00:00.000Z',
    updatedAt: '2026-07-28T15:00:00.000Z',
  };
}
