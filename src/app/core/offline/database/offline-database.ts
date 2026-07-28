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

    this.opening = this.openRequest(factory).finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }

  async createTransaction(
    storeNames: readonly OfflineStoreName[],
    mode: IDBTransactionMode,
  ): Promise<IDBTransaction> {
    const database = await this.open();
    if (mode !== 'readwrite') {
      try {
        return database.transaction([...storeNames], mode);
      } catch (error) {
        throw toOfflineStorageError(error, 'Não foi possível iniciar a transação local.');
      }
    }

    try {
      return database.transaction([...storeNames], mode, { durability: 'strict' });
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw toOfflineStorageError(error, 'Não foi possível iniciar a transação local.');
      }
      try {
        return database.transaction([...storeNames], mode);
      } catch (fallbackError) {
        throw toOfflineStorageError(
          fallbackError,
          'Não foi possível iniciar a transação local.',
        );
      }
    }
  }

  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  private openRequest(factory: IDBFactory): Promise<IDBDatabase> {
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
