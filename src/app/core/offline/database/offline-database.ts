import { Inject, Injectable, InjectionToken } from '@angular/core';

import { OfflineStorageError, toOfflineStorageError } from '../models/offline-storage-error';
import { DATABASE_MIGRATIONS, DatabaseMigration, runDatabaseMigrations } from './database-migrations';
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  OFFLINE_DATABASE_SCHEMA,
  OfflineStoreName,
} from './database-schema';

export type IndexedDbProvider = () => IDBFactory | undefined;

export interface OfflineDatabaseConfig {
  readonly name: string;
  readonly version: number;
  readonly migrations: readonly DatabaseMigration[];
}

export const OFFLINE_DATABASE_CONFIG: OfflineDatabaseConfig = Object.freeze({
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  migrations: DATABASE_MIGRATIONS,
});

export const INDEXED_DB_PROVIDER = new InjectionToken<IndexedDbProvider>(
  'OFFLINE_INDEXED_DB_PROVIDER',
  {
    providedIn: 'root',
    factory: () => () => {
      if (typeof globalThis.window === 'undefined') {
        return undefined;
      }
      const candidate = globalThis.indexedDB;
      return candidate && typeof candidate.open === 'function' ? candidate : undefined;
    },
  },
);

export const OFFLINE_DATABASE_CONFIGURATION = new InjectionToken<OfflineDatabaseConfig>(
  'OFFLINE_DATABASE_CONFIGURATION',
  {
    providedIn: 'root',
    factory: () => OFFLINE_DATABASE_CONFIG,
  },
);

@Injectable({ providedIn: 'root' })
export class OfflineDatabase {
  private connection?: IDBDatabase;
  private opening?: Promise<IDBDatabase>;
  private lifecycleEpoch = 0;

  constructor(
    @Inject(INDEXED_DB_PROVIDER) private readonly provideFactory: IndexedDbProvider,
    @Inject(OFFLINE_DATABASE_CONFIGURATION) private readonly config: OfflineDatabaseConfig,
  ) {}

  open(): Promise<IDBDatabase> {
    if (this.connection) {
      return Promise.resolve(this.connection);
    }
    if (this.opening) {
      return this.opening;
    }

    let factory: IDBFactory | undefined;
    try {
      factory = this.provideFactory();
    } catch (error) {
      return Promise.reject(
        toOfflineStorageError(
          error,
          'Não foi possível acessar a capacidade de persistência local.',
        ),
      );
    }
    if (!factory) {
      return Promise.reject(
        new OfflineStorageError(
          'CAPABILITY_UNAVAILABLE',
          'A persistência operacional não está disponível neste contexto.',
        ),
      );
    }

    const epoch = this.lifecycleEpoch;
    let opening!: Promise<IDBDatabase>;
    opening = this.openRequest(factory, epoch).finally(() => {
      if (this.opening === opening) {
        this.opening = undefined;
      }
    });
    this.opening = opening;
    return opening;
  }

  async createTransaction(
    storeNames: readonly OfflineStoreName[],
    mode: IDBTransactionMode,
  ): Promise<IDBTransaction> {
    let database = await this.open();
    try {
      return createNativeTransaction(database, storeNames, mode);
    } catch (error) {
      if (!isInvalidStateError(error) || this.connection !== database) {
        throw toOfflineStorageError(error, 'Não foi possível iniciar a transação local.');
      }
      this.connection = undefined;
      database = await this.open();
      try {
        return createNativeTransaction(database, storeNames, mode);
      } catch (retryError) {
        throw toOfflineStorageError(retryError, 'Não foi possível iniciar a transação local.');
      }
    }
  }

  close(): void {
    this.lifecycleEpoch += 1;
    this.connection?.close();
    this.connection = undefined;
    this.opening = undefined;
  }

  private openRequest(factory: IDBFactory, epoch: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let upgradeError: unknown;
      let settled = false;

      try {
        request = factory.open(this.config.name, this.config.version);
      } catch (error) {
        reject(toOfflineStorageError(error, 'Não foi possível abrir o armazenamento local.'));
        return;
      }

      request.onupgradeneeded = (event) => {
        if (settled || epoch !== this.lifecycleEpoch) {
          upgradeError = new DOMException(
            'A abertura foi invalidada antes da migration.',
            'AbortError',
          );
          request.transaction?.abort();
          return;
        }
        try {
          runDatabaseMigrations({
            database: request.result,
            transaction: request.transaction!,
            oldVersion: event.oldVersion,
            targetVersion: this.config.version,
            migrations: this.config.migrations,
          });
        } catch (error) {
          upgradeError = error;
          request.transaction?.abort();
        }
      };
      request.onblocked = () => {
        settled = true;
        reject(
          new OfflineStorageError(
            'BLOCKED',
            'Outra aba precisa liberar a versão anterior do armazenamento local.',
          ),
        );
      };
      request.onerror = () => {
        settled = true;
        reject(
          toOfflineStorageError(
            upgradeError ?? request.error,
            'Não foi possível abrir o armazenamento local.',
          ),
        );
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        if (epoch !== this.lifecycleEpoch) {
          settled = true;
          database.close();
          reject(
            new OfflineStorageError(
              'ABORTED',
              'A abertura do armazenamento local foi cancelada.',
            ),
          );
          return;
        }

        try {
          validateSchema(database);
        } catch (error) {
          database.close();
          reject(error);
          return;
        }

        database.onversionchange = () => {
          database.close();
          if (this.connection === database) {
            this.connection = undefined;
          }
        };
        database.onclose = () => {
          if (this.connection === database) {
            this.connection = undefined;
          }
        };
        this.connection = database;
        settled = true;
        resolve(database);
      };
    });
  }
}

function createNativeTransaction(
  database: IDBDatabase,
  storeNames: readonly OfflineStoreName[],
  mode: IDBTransactionMode,
): IDBTransaction {
  if (mode !== 'readwrite') {
    return database.transaction([...storeNames], mode);
  }
  try {
    return database.transaction([...storeNames], mode, { durability: 'strict' });
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
    return database.transaction([...storeNames], mode);
  }
}

function isInvalidStateError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'InvalidStateError';
}

function validateSchema(database: IDBDatabase): void {
  for (const storeSchema of OFFLINE_DATABASE_SCHEMA.stores) {
    if (!database.objectStoreNames.contains(storeSchema.name)) {
      throw schemaInvalid();
    }
    const transaction = database.transaction(storeSchema.name, 'readonly');
    const store = transaction.objectStore(storeSchema.name);
    if (store.keyPath !== storeSchema.keyPath) {
      throw schemaInvalid();
    }
    for (const indexSchema of storeSchema.indexes) {
      if (!store.indexNames.contains(indexSchema.name)) {
        throw schemaInvalid();
      }
      const index = store.index(indexSchema.name);
      if (
        JSON.stringify(index.keyPath) !== JSON.stringify(indexSchema.keyPath) ||
        index.unique !== indexSchema.unique
      ) {
        throw schemaInvalid();
      }
    }
  }
}

function schemaInvalid(): OfflineStorageError {
  return new OfflineStorageError(
    'SCHEMA_INVALID',
    'O schema local é incompatível e requer intervenção; nenhum dado foi removido.',
  );
}
