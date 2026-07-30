import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import {
  DATABASE_MIGRATIONS,
  DatabaseMigration,
} from '../database/database-migrations';
import {
  OFFLINE_DATABASE_CONFIG,
  OfflineDatabase,
} from '../database/offline-database';
import {
  DATABASE_VERSION,
  OUTBOX_STORE,
} from '../database/database-schema';
import { OfflineStorageError } from '../models/offline-storage-error';
import { LocalCommandRepository } from '../repositories/local-command.repository';
import { LocalRecordRepository } from '../repositories/local-record.repository';
import { OutboxRepository } from '../repositories/outbox.repository';

const COMMAND_ID = '123e4567-e89b-42d3-a456-426614174000';
const ROLLBACK_ID = '223e4567-e89b-42d3-a456-426614174000';
const COLLISION_IDEMPOTENCY_KEY = '323e4567-e89b-42d3-a456-426614174000';
const OWNER_ID = 'playwright-operator';

@Component({
  selector: 'app-offline-persistence-harness',
  template: `
    <button type="button" data-testid="persist-command" (click)="persist()">Persistir</button>
    <button type="button" data-testid="persist-operational-matrix" (click)="persistOperationalMatrix()">
      Persistir matriz operacional
    </button>
    <button type="button" data-testid="verify-storage" (click)="verify()">Verificar</button>
    <pre data-testid="harness-result">{{ result() }}</pre>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfflinePersistenceHarness {
  private readonly database = inject(OfflineDatabase);
  private readonly commands = inject(LocalCommandRepository);
  private readonly localRecords = inject(LocalRecordRepository);
  private readonly outbox = inject(OutboxRepository);

  readonly result = signal('');

  async persist(): Promise<void> {
    try {
      const persisted = await this.commands.persistConfirmedCommand({
        ownerId: OWNER_ID,
        aggregateType: 'PLAYWRIGHT_REPORT',
        aggregateId: 'OP-E2E',
        commandType: 'CONFIRM_REPORT',
        payload: { quantity: 5 },
        payloadSchemaVersion: 1,
        idempotencyKey: COMMAND_ID,
        occurredAt: '2026-07-29T12:00:00.000Z',
      });
      this.result.set(
        JSON.stringify({
          committed: true,
          localId: persisted.localId,
          status: persisted.outboxEntry.status,
        }),
      );
    } catch (error) {
      this.result.set(JSON.stringify(safeError(error)));
    }
  }

  async verify(): Promise<void> {
    try {
      const recovered = await this.outbox.getById(OWNER_ID, COMMAND_ID);
      await this.seedOutboxPrimaryKeyCollision();

      let abortCode = '';
      try {
        await this.commands.persistConfirmedCommand({
          ownerId: OWNER_ID,
          aggregateType: 'PLAYWRIGHT_REPORT',
          aggregateId: 'OP-ROLLBACK',
          commandType: 'CONFIRM_REPORT',
          payload: { quantity: 9 },
          payloadSchemaVersion: 1,
          idempotencyKey: ROLLBACK_ID,
        });
      } catch (error) {
        abortCode = error instanceof OfflineStorageError ? error.code : 'UNKNOWN';
      }

      const rolledBack = await this.localRecords.getById(OWNER_ID, ROLLBACK_ID);
      const upgrade = await this.upgradeWithProductionDatabase();

      this.result.set(
        JSON.stringify({
          recoveredStatus: recovered?.status,
          recoveredPayload: recovered?.payload,
          abortCode,
          rolledBack,
          ...upgrade,
        }),
      );
    } catch (error) {
      this.result.set(JSON.stringify(safeError(error)));
    }
  }

  async persistOperationalMatrix(): Promise<void> {
    const types = [
      'GENERATE_INSPECTION_ROUTE',
      'SAVE_MEASUREMENT',
      'FINISH_EXAM',
      'STOP_INSPECTION_ROUTE',
      'SAVE_INSPECTION',
      'START_OPERATION',
      'REPORT_OPERATION',
      'END_OPERATION',
      'START_BATCH',
      'REPORT_BATCH',
      'END_BATCH',
      'CREATE_STOP',
      'FINISH_STOP',
    ] as const;
    const keys = types.map((_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
    try {
      for (const [index, commandType] of types.entries()) {
        const family = commandType.includes('BATCH')
          ? 'BATCH'
          : commandType.includes('STOP')
            ? 'STOP'
            : commandType.includes('OPERATION')
              ? 'OPERATION'
              : 'QUALITY';
        await this.commands.persistConfirmedCommand({
          ownerId: OWNER_ID,
          aggregateType: family,
          aggregateId: family === 'STOP' ? keys[11] : `${family}-E2E`,
          commandType,
          payload: commandType.includes('BATCH')
            ? { orderIds: ['OP-1', 'OP-2'], sequence: index }
            : { sequence: index },
          payloadSchemaVersion: 1,
          idempotencyKey: keys[index],
          ...(commandType === 'FINISH_STOP' ? { dependencyIds: [keys[11]] } : {}),
        });
      }
      this.result.set(JSON.stringify({ operationalMatrix: types.length }));
    } catch (error) {
      this.result.set(JSON.stringify(safeError(error)));
    }
  }

  private async seedOutboxPrimaryKeyCollision(): Promise<void> {
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    transaction.objectStore(OUTBOX_STORE).add({
      localId: ROLLBACK_ID,
      idempotencyKey: COLLISION_IDEMPOTENCY_KEY,
      ownerId: OWNER_ID,
      status: 'PENDING',
      createdAt: '2026-07-29T12:01:00.000Z',
    });
    await completed;
  }

  private async upgradeWithProductionDatabase(): Promise<{
    readonly receivedVersionChange: boolean;
    readonly version: number;
    readonly hasProbe: boolean;
    readonly pendingPreserved: boolean;
  }> {
    const oldConnection = await this.database.open();
    let receivedVersionChange = false;
    oldConnection.addEventListener('versionchange', () => {
      receivedVersionChange = true;
    });

    const migration: DatabaseMigration = {
      toVersion: DATABASE_VERSION + 1,
      migrate: ({ database }) =>
        database.createObjectStore('playwrightMigrationProbe', { keyPath: 'id' }),
    };
    const upgradedDatabase = new OfflineDatabase(
      () => globalThis.indexedDB,
      {
        ...OFFLINE_DATABASE_CONFIG,
        version: DATABASE_VERSION + 1,
        migrations: [...DATABASE_MIGRATIONS, migration],
      },
    );
    const upgradedConnection = await upgradedDatabase.open();
    const pending = await requestResult(
      upgradedConnection
        .transaction(OUTBOX_STORE, 'readonly')
        .objectStore(OUTBOX_STORE)
        .get(COMMAND_ID),
    );
    const result = {
      receivedVersionChange,
      version: upgradedConnection.version,
      hasProbe: upgradedConnection.objectStoreNames.contains('playwrightMigrationProbe'),
      pendingPreserved: Boolean(pending),
    };
    upgradedDatabase.close();
    return result;
  }
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestResult(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function safeError(error: unknown): { readonly error: string } {
  return {
    error: error instanceof OfflineStorageError ? error.code : 'UNKNOWN',
  };
}
