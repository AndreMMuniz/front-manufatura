import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import { OfflineStorageError, toOfflineStorageError } from '../models/offline-storage-error';
import { DATABASE_MIGRATIONS, runDatabaseMigrations } from './database-migrations';
import { DATABASE_NAME } from './database-schema';
import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from './offline-database';

describe('OfflineDatabase', () => {
  it('não consulta a factory no construtor e abre somente sob demanda', async () => {
    const provider = vi.fn(() => new IDBFactory());
    const database = new OfflineDatabase(provider, OFFLINE_DATABASE_CONFIG);

    expect(provider).not.toHaveBeenCalled();
    await expect(database.open()).resolves.toBeInstanceOf(Object);
    expect(provider).toHaveBeenCalledOnce();
    database.close();
  });

  it('retorna indisponibilidade tipada no SSR/browser sem IndexedDB', async () => {
    const database = new OfflineDatabase(() => undefined, OFFLINE_DATABASE_CONFIG);

    await expect(database.open()).rejects.toEqual(
      expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }),
    );
  });

  it('mapeia SecurityError síncrono da factory sem lançar detalhe inseguro', async () => {
    const database = new OfflineDatabase(
      () => {
        throw new DOMException('origem privada', 'SecurityError');
      },
      OFFLINE_DATABASE_CONFIG,
    );

    await expect(database.open()).rejects.toEqual(
      expect.objectContaining({
        code: 'SECURITY',
        message: 'Não foi possível acessar a capacidade de persistência local.',
      }),
    );
  });

  it('retorna BLOCKED quando uma conexão sem política de versionchange impede o upgrade', async () => {
    const factory = new IDBFactory();
    const legacy = await rawVersionOne(factory);
    const config = {
      ...OFFLINE_DATABASE_CONFIG,
      version: 2,
      migrations: [
        ...DATABASE_MIGRATIONS,
        {
          toVersion: 2,
          migrate: ({ database }: { database: IDBDatabase }) =>
            database.createObjectStore('blockedProbe'),
        },
      ],
    };
    const upgrading = new OfflineDatabase(() => factory, config);

    await expect(upgrading.open()).rejects.toEqual(expect.objectContaining({ code: 'BLOCKED' }));
    legacy.close();
  });

  it('fecha a conexão antiga em versionchange e permite upgrade seguro', async () => {
    const factory = new IDBFactory();
    const first = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    const connection = await first.open();
    const closeSpy = vi.spyOn(connection, 'close');
    const upgraded = openVersionTwo(factory);

    await expect(upgraded).resolves.toMatchObject({ version: 2 });
    expect(closeSpy).toHaveBeenCalledOnce();
    (await upgraded).close();
  });

  it.each([
    ['VersionError', 'VERSION_INCOMPATIBLE'],
    ['SecurityError', 'SECURITY'],
    ['QuotaExceededError', 'QUOTA_EXCEEDED'],
    ['AbortError', 'ABORTED'],
    ['ConstraintError', 'CONSTRAINT'],
  ])('mapeia %s para erro acionável %s', (name, code) => {
    expect(toOfflineStorageError(new DOMException('unsafe detail', name), 'Falha segura.')).toEqual(
      expect.objectContaining({ code, message: 'Falha segura.' }),
    );
  });

  it('mantém falhas desconhecidas tipadas sem copiar detalhes inseguros', () => {
    const mapped = toOfflineStorageError(new Error('payload secreto'), 'Falha segura.');

    expect(mapped).toBeInstanceOf(OfflineStorageError);
    expect(mapped).toMatchObject({ code: 'UNKNOWN', message: 'Falha segura.' });
    expect(mapped.message).not.toContain('payload secreto');
    expect(mapped.cause).toBeUndefined();
  });
});

function openVersionTwo(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, 2);
    request.onupgradeneeded = (event) => {
      const migrations = [
        ...DATABASE_MIGRATIONS,
        {
          toVersion: 2,
          migrate: ({ database }: { database: IDBDatabase }) =>
            database.createObjectStore('upgradeProbe'),
        },
      ];
      runDatabaseMigrations({
        database: request.result,
        transaction: request.transaction!,
        oldVersion: event.oldVersion,
        targetVersion: 2,
        migrations,
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function rawVersionOne(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, 1);
    request.onupgradeneeded = (event) => {
      runDatabaseMigrations({
        database: request.result,
        transaction: request.transaction!,
        oldVersion: event.oldVersion,
        targetVersion: 1,
        migrations: DATABASE_MIGRATIONS,
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
