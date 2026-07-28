import { expect, test } from '@playwright/test';

const DATABASE_NAME = 'plano-de-controle-operational';

test('IndexedDB real preserva commit, abort, reload e upgrade/versionchange', async ({ page }) => {
  await page.goto('/login');

  const committed = await page.evaluate(async (databaseName) => {
    const database = await openDatabase(databaseName, 1, (db) => {
      const local = db.createObjectStore('localRecords', { keyPath: 'localId' });
      local.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
      const outbox = db.createObjectStore('outbox', { keyPath: 'localId' });
      outbox.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
    });
    const command = {
      localId: '123e4567-e89b-42d3-a456-426614174000',
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      ownerId: 'operator-1',
      payload: { quantity: 5 },
      payloadHash: 'stable-hash',
      status: 'PENDING',
      attemptCount: 0,
      createdAt: '2026-07-28T16:00:00.000Z',
    };
    const transaction = database.transaction(['localRecords', 'outbox'], 'readwrite', {
      durability: 'strict',
    });
    const completion = transactionComplete(transaction);
    transaction.objectStore('localRecords').add(command);
    transaction.objectStore('outbox').add(command);
    await completion;
    database.close();
    return true;

    function openDatabase(
      name: string,
      version: number,
      upgrade: (database: IDBDatabase) => void,
    ): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => upgrade(request.result);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }

    function transactionComplete(transaction: IDBTransaction): Promise<void> {
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    }
  }, DATABASE_NAME);
  expect(committed).toBe(true);

  await page.reload();
  const afterReloadAndAbort = await page.evaluate(async (databaseName) => {
    const database = await open(databaseName, 1);
    const recovered = await get(database.transaction('outbox').objectStore('outbox'), '123e4567-e89b-42d3-a456-426614174000');

    const transaction = database.transaction(['localRecords', 'outbox'], 'readwrite');
    const aborted = complete(transaction).then(
      () => false,
      () => true,
    );
    transaction.objectStore('localRecords').add({
      localId: '223e4567-e89b-42d3-a456-426614174000',
      idempotencyKey: '223e4567-e89b-42d3-a456-426614174000',
    });
    transaction.objectStore('outbox').add({
      localId: '223e4567-e89b-42d3-a456-426614174000',
      idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
    });
    const didAbort = await aborted;
    const rolledBack = await get(
      database.transaction('localRecords').objectStore('localRecords'),
      '223e4567-e89b-42d3-a456-426614174000',
    );
    database.close();
    return { recovered, didAbort, rolledBack };

    function open(name: string, version: number): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }
    function get(store: IDBObjectStore, key: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    function complete(transaction: IDBTransaction): Promise<void> {
      return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    }
  }, DATABASE_NAME);

  expect(afterReloadAndAbort.recovered).toMatchObject({
    ownerId: 'operator-1',
    status: 'PENDING',
    payload: { quantity: 5 },
  });
  expect(afterReloadAndAbort.didAbort).toBe(true);
  expect(afterReloadAndAbort.rolledBack).toBeUndefined();

  const upgrade = await page.evaluate(async (databaseName) => {
    const oldConnection = await open(databaseName, 1);
    let receivedVersionChange = false;
    oldConnection.onversionchange = () => {
      receivedVersionChange = true;
      oldConnection.close();
    };
    const upgraded = await open(databaseName, 2, (database) => {
      database.createObjectStore('migrationProbe', { keyPath: 'id' });
    });
    const pending = await get(
      upgraded.transaction('outbox').objectStore('outbox'),
      '123e4567-e89b-42d3-a456-426614174000',
    );
    const result = {
      receivedVersionChange,
      version: upgraded.version,
      hasProbe: upgraded.objectStoreNames.contains('migrationProbe'),
      pending,
    };
    upgraded.close();
    return result;

    function open(
      name: string,
      version: number,
      upgrade?: (database: IDBDatabase) => void,
    ): Promise<IDBDatabase> {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => upgrade?.(request.result);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });
    }
    function get(store: IDBObjectStore, key: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
  }, DATABASE_NAME);

  expect(upgrade).toMatchObject({
    receivedVersionChange: true,
    version: 2,
    hasProbe: true,
    pending: { ownerId: 'operator-1', status: 'PENDING' },
  });
});
