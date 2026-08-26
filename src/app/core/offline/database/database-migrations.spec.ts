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
  it('cria o schema 0 -> target com stores, key paths e índices obrigatórios', async () => {
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

  it('executa 1 -> target e preserva conteúdo ao aplicar classificações conhecidas', async () => {
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
      fixtures.map((fixture) => ({
        ...fixture,
        ...(fixture.status === 'SYNCING'
          ? { leaseExpiresAt: '1970-01-01T00:00:00.000Z' }
          : {}),
        ...(fixture.status === 'SYNCED' ? { deliveryOutcome: 'CONFIRMED' } : {}),
      })),
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

  it('classifica resultados de entrega legados ao migrar 3 -> 4 sem reescrever o histórico', async () => {
    const factory = new IDBFactory();
    const versionThree = await openDatabase(
      factory,
      3,
      DATABASE_MIGRATIONS.filter((migration) => migration.toVersion <= 3),
    );
    const fixtures = [
      legacyFixture('synced', 'SYNCED'),
      legacyFixture('validation', 'ERROR', {
        attemptCount: 1,
        lastAttemptAt: '2026-07-28T15:01:00.000Z',
        lastError: legacyError('VALIDATION', 'VALIDATION'),
      }),
      legacyFixture('conflict', 'ERROR', {
        attemptCount: 1,
        lastAttemptAt: '2026-07-28T15:02:00.000Z',
        lastError: legacyError('CONFLICT', 'CONFLICT'),
      }),
      legacyFixture('legacy-transient', 'RETRY_WAIT', {
        attemptCount: 1,
        lastAttemptAt: '2026-07-28T15:03:00.000Z',
        nextAttemptAt: '2026-07-28T15:04:00.000Z',
        lastError: legacyError('NETWORK', 'TRANSIENT'),
      }),
      legacyFixture('never-attempted', 'PENDING'),
    ];
    for (const fixture of fixtures) {
      await addAndComplete(versionThree, OUTBOX_STORE, fixture);
    }
    versionThree.close();

    const upgraded = await openDatabase(factory, DATABASE_VERSION, DATABASE_MIGRATIONS);
    const migrated = await requestResult<OutboxEntry[]>(
      upgraded.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll(),
    );
    const byId = new Map(migrated.map((entry) => [entry.localId, entry]));

    expect(byId.get('synced')).toMatchObject({ status: 'SYNCED', deliveryOutcome: 'CONFIRMED' });
    expect(byId.get('validation')).toMatchObject({ status: 'ERROR', deliveryOutcome: 'REJECTED' });
    expect(byId.get('conflict')).toMatchObject({ status: 'ERROR', deliveryOutcome: 'REJECTED' });
    expect(byId.get('legacy-transient')).toMatchObject({
      status: 'CONFIRMATION_PENDING', deliveryOutcome: 'UNCERTAIN',
    });
    expect(byId.get('never-attempted')).not.toHaveProperty('deliveryOutcome');
    expect(byId.get('legacy-transient')).toMatchObject({
      payload: fixtures[3].payload,
      payloadHash: fixtures[3].payloadHash,
      idempotencyKey: fixtures[3].idempotencyKey,
      ownerId: fixtures[3].ownerId,
      attemptCount: fixtures[3].attemptCount,
      lastAttemptAt: fixtures[3].lastAttemptAt,
      nextAttemptAt: fixtures[3].nextAttemptAt,
      lastError: fixtures[3].lastError,
    });
    upgraded.close();

    const reopened = await openDatabase(factory, DATABASE_VERSION, DATABASE_MIGRATIONS);
    const reopenedEntries = await requestResult<OutboxEntry[]>(
      reopened.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll(),
    );
    expect(reopenedEntries).toEqual(migrated);
    reopened.close();
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

function legacyFixture(
  localId: string,
  status: OutboxEntry['status'],
  overrides: Partial<OutboxEntry<{ readonly quantity: number }>> = {},
): OutboxEntry<{ readonly quantity: number }> {
  return {
    ...pendingFixture(status),
    localId,
    idempotencyKey: localId,
    payloadHash: `hash-${localId}`,
    ...overrides,
  };
}

function legacyError(code: string, category: 'VALIDATION' | 'CONFLICT' | 'TRANSIENT') {
  return {
    code,
    category,
    userMessage: 'Falha histórica.',
    deliveryOutcome: 'NOT_DELIVERED' as const,
  };
}
