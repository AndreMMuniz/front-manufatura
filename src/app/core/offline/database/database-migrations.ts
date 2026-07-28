import { OfflineStorageError } from '../models/offline-storage-error';
import { DATABASE_VERSION, OFFLINE_DATABASE_SCHEMA } from './database-schema';

export interface DatabaseMigrationContext {
  readonly database: IDBDatabase;
  readonly transaction: IDBTransaction;
}

export interface DatabaseMigration {
  readonly toVersion: number;
  readonly migrate: (context: DatabaseMigrationContext) => void;
}

export interface RunMigrationsRequest extends DatabaseMigrationContext {
  readonly oldVersion: number;
  readonly targetVersion: number;
  readonly migrations: readonly DatabaseMigration[];
}

const INITIAL_SCHEMA_MIGRATION: DatabaseMigration = {
  toVersion: 1,
  migrate: ({ database }) => {
    for (const storeSchema of OFFLINE_DATABASE_SCHEMA.stores) {
      const store = database.createObjectStore(storeSchema.name, { keyPath: storeSchema.keyPath });
      for (const indexSchema of storeSchema.indexes) {
        const keyPath =
          typeof indexSchema.keyPath === 'string' ? indexSchema.keyPath : [...indexSchema.keyPath];
        store.createIndex(indexSchema.name, keyPath, {
          unique: indexSchema.unique,
        });
      }
    }
  },
};

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = Object.freeze([
  INITIAL_SCHEMA_MIGRATION,
]);

export function runDatabaseMigrations(request: RunMigrationsRequest): void {
  if (request.oldVersion > request.targetVersion) {
    throw new OfflineStorageError(
      'VERSION_INCOMPATIBLE',
      'A versão local é mais nova que a suportada pela aplicação.',
    );
  }

  const ordered = [...request.migrations].sort((left, right) => left.toVersion - right.toVersion);
  for (let version = request.oldVersion + 1; version <= request.targetVersion; version += 1) {
    const migration = ordered.find((candidate) => candidate.toVersion === version);
    if (!migration) {
      throw new OfflineStorageError(
        'SCHEMA_INVALID',
        'A sequência de migrations do armazenamento local está incompleta.',
      );
    }
    migration.migrate(request);
  }
}

if (DATABASE_MIGRATIONS.at(-1)?.toVersion !== DATABASE_VERSION) {
  throw new Error('O registry de migrations deve terminar na versão de produção.');
}
