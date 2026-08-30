import { OfflineStorageError } from '../models/offline-storage-error';
import {
  DATABASE_VERSION,
  LOCAL_RECORDS_STORE,
  OUTBOX_STORE,
  SYNC_RECEIPTS_STORE,
} from './database-schema';

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
    for (const storeSchema of VERSION_ONE_STORES) {
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

// Historical migrations are immutable snapshots. Never derive an old migration
// from OFFLINE_DATABASE_SCHEMA, which evolves with the current target version.
const VERSION_ONE_STORES = [
  {
    name: LOCAL_RECORDS_STORE,
    keyPath: 'localId',
    indexes: [
      { name: 'idempotencyKey', keyPath: 'idempotencyKey', unique: true },
      { name: 'ownerId', keyPath: 'ownerId', unique: false },
      {
        name: 'ownerAggregate',
        keyPath: ['ownerId', 'aggregateType', 'aggregateId'],
        unique: false,
      },
      { name: 'createdAt', keyPath: 'createdAt', unique: false },
    ],
  },
  {
    name: OUTBOX_STORE,
    keyPath: 'localId',
    indexes: [
      { name: 'idempotencyKey', keyPath: 'idempotencyKey', unique: true },
      { name: 'ownerId', keyPath: 'ownerId', unique: false },
      { name: 'status', keyPath: 'status', unique: false },
      { name: 'ownerStatus', keyPath: ['ownerId', 'status'], unique: false },
      {
        name: 'aggregateCreatedAt',
        keyPath: ['aggregateType', 'aggregateId', 'createdAt'],
        unique: false,
      },
      { name: 'createdAt', keyPath: 'createdAt', unique: false },
    ],
  },
] as const;

const SCHEDULER_SCHEMA_MIGRATION: DatabaseMigration = {
  toVersion: 2,
  migrate: ({ transaction }) => {
    const outbox = transaction.objectStore(OUTBOX_STORE);
    outbox.createIndex(
      'ownerStatusDue',
      ['ownerId', 'status', 'nextAttemptAt'],
      { unique: false },
    );
    outbox.createIndex(
      'ownerAggregateOrder',
      ['ownerId', 'aggregateType', 'aggregateId', 'createdAt', 'localId'],
      { unique: false },
    );
    const cursorRequest = outbox.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        return;
      }
      const entry = cursor.value as Readonly<Record<string, unknown>>;
      if (entry['status'] === 'SYNCING' && typeof entry['leaseExpiresAt'] !== 'string') {
        cursor.update({
          ...entry,
          leaseExpiresAt: '1970-01-01T00:00:00.000Z',
        });
      }
      cursor.continue();
    };
  },
};

const SYNCHRONIZATION_CENTER_MIGRATION: DatabaseMigration = {
  toVersion: 3,
  migrate: ({ transaction }) => {
    transaction.objectStore(OUTBOX_STORE).createIndex(
      'ownerOccurredAtLocalId',
      ['ownerId', 'occurredAt', 'localId'],
      { unique: false },
    );
  },
};

const SYNC_RECEIPTS_MIGRATION: DatabaseMigration = {
  toVersion: 4,
  migrate: ({ database }) => {
    const store = database.createObjectStore(SYNC_RECEIPTS_STORE, { keyPath: 'localId' });
    store.createIndex('ownerId', 'ownerId', { unique: false });
    store.createIndex('ownerArchivedAt', ['ownerId', 'archivedAt'], { unique: false });
    store.createIndex('ownerExpiresAt', ['ownerId', 'expiresAt'], { unique: false });
    store.createIndex(
      'ownerAggregate',
      ['ownerId', 'aggregateType', 'aggregateId'],
      { unique: false },
    );
  },
};

const TERMINAL_BUSINESS_REJECTIONS_MIGRATION: DatabaseMigration = {
  toVersion: 5,
  migrate: ({ transaction }) => {
    const request = transaction.objectStore(OUTBOX_STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const entry = cursor.value as Readonly<Record<string, unknown>>;
      const lastError = entry['lastError'];
      const category = lastError && typeof lastError === 'object'
        ? (lastError as Readonly<Record<string, unknown>>)['category']
        : undefined;
      const disposition = entry['deliveryDisposition'];
      if (
        entry['status'] === 'ERROR'
        && (disposition === undefined || disposition === 'ACTIVE')
        && (category === 'VALIDATION' || category === 'CONFLICT')
      ) {
        cursor.update({ ...entry, deliveryDisposition: 'REJECTED' });
      }
      cursor.continue();
    };
  },
};

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = Object.freeze([
  INITIAL_SCHEMA_MIGRATION,
  SCHEDULER_SCHEMA_MIGRATION,
  SYNCHRONIZATION_CENTER_MIGRATION,
  SYNC_RECEIPTS_MIGRATION,
  TERMINAL_BUSINESS_REJECTIONS_MIGRATION,
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
