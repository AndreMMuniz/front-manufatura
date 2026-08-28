import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCAL_RECORDS_STORE,
  OUTBOX_STORE,
  SYNC_RECEIPTS_STORE,
} from '../database/database-schema';
import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from '../database/offline-database';
import { JsonValue, LocalRecord } from '../models/local-record';
import { OutboxEntry, RemoteCommandReceipt } from '../models/outbox-entry';
import { SyncReceiptRecord } from '../models/sync-receipt-record';
import { OutboxActivityService } from '../services/outbox-activity.service';
import { requestResult, transactionComplete } from './repository-utils';
import { SyncRetentionRepository } from './sync-retention.repository';

const OWNER = 'operator-1';
const OTHER_OWNER = 'operator-2';
const AGGREGATE_TYPE = 'OPERATION';
const AGGREGATE_ID = '450001|10|1';
const START_LOCAL_ID = 'start-operation';
const REPORT_LOCAL_ID = 'report-operation';
const END_LOCAL_ID = 'end-operation';
const SYNCHRONIZED_AT = '2026-07-29T13:00:00.000Z';
const ARCHIVED_AT = '2026-08-28T13:00:00.000Z';
const EXPIRES_AT = '2026-09-28T13:00:00.000Z';

describe('SyncRetentionRepository', () => {
  let database: OfflineDatabase;
  let repository: SyncRetentionRepository;
  let activity: OutboxActivityService;

  beforeEach(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
    database = new OfflineDatabase(() => new IDBFactory(), OFFLINE_DATABASE_CONFIG);
    activity = { publish: vi.fn() } as unknown as OutboxActivityService;
    repository = new SyncRetentionRepository(database, activity);
  });

  afterEach(() => {
    database.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    'PENDING',
    'SYNCING',
    'RETRY_WAIT',
    'BLOCKED_AUTH',
    'BLOCKED_DEPENDENCY',
    'ERROR',
  ] as const)('não compacta quando existe comando %s', async (status) => {
    await seedClosedAggregate({ reportStatus: status });

    await expect(compact()).resolves.toBe('ineligible');

    expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(3);
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
    expect(activity.publish).not.toHaveBeenCalled();
  });

  it.each(['SUPERSEDED', 'ABANDONED'] as const)(
    'não abre exceção para comando ERROR com disposition %s',
    async (deliveryDisposition) => {
      await seedClosedAggregate({
        reportStatus: 'ERROR',
        reportDeliveryDisposition: deliveryDisposition,
      });

      await expect(compact()).resolves.toBe('ineligible');

      expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(3);
      expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
    },
  );

  it('não compacta comando SYNCED sem recibo remoto', async () => {
    await seedClosedAggregate({ reportHasReceipt: false });

    await expect(compact()).resolves.toBe('ineligible');

    expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(3);
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
  });

  it('não compacta agregado inexistente', async () => {
    await expect(compact()).resolves.toBe('ineligible');

    expect(activity.publish).not.toHaveBeenCalled();
  });

  it('não compacta sem END_OPERATION sincronizado', async () => {
    await seedActiveAggregate();

    await expect(compact()).resolves.toBe('ineligible');

    expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(2);
    expect(await readStore<LocalRecord<JsonValue>>(LOCAL_RECORDS_STORE)).toHaveLength(2);
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
  });

  it('não compacta quando outro comando ativo depende do agregado', async () => {
    await seedClosedAggregate();
    await seedDependentCommand({ status: 'PENDING' });

    await expect(compact()).resolves.toBe('ineligible');

    expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(4);
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
  });

  it.each(['SUPERSEDED', 'ABANDONED'] as const)(
    'não abre exceção para dependente não sincronizado com disposition %s',
    async (deliveryDisposition) => {
      await seedClosedAggregate();
      await seedDependentCommand({ status: 'PENDING', deliveryDisposition });

      await expect(compact()).resolves.toBe('ineligible');

      expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(4);
      expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
    },
  );

  it('ignora dependente já sincronizado', async () => {
    await seedClosedAggregate();
    await seedDependentCommand({ status: 'SYNCED' });

    await expect(compact()).resolves.toBe('compacted');

    expect(
      (await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).map((entry) => entry.localId),
    ).toEqual(['dependent-command']);
  });

  it('arquiva recibos e remove localRecords/outbox atomicamente quando elegível', async () => {
    await seedClosedAggregate();

    await expect(compact()).resolves.toBe('compacted');

    expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toEqual([]);
    expect(await readStore<LocalRecord<JsonValue>>(LOCAL_RECORDS_STORE)).toEqual([]);
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localId: REPORT_LOCAL_ID,
          ownerId: OWNER,
          aggregateType: AGGREGATE_TYPE,
          aggregateId: AGGREGATE_ID,
          commandType: 'REPORT_OPERATION',
          status: 'SYNCED',
          synchronizedAt: SYNCHRONIZED_AT,
          archivedAt: ARCHIVED_AT,
          expiresAt: EXPIRES_AT,
          receipt: receipt(REPORT_LOCAL_ID),
        }),
      ]),
    );
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(3);
    expect(activity.publish).toHaveBeenCalledOnce();
  });

  it('publica atividade somente depois do commit dos três stores', async () => {
    await seedClosedAggregate();
    const createTransaction = database.createTransaction.bind(database);
    let committed = false;
    let committedWhenPublished: boolean | undefined;
    vi.spyOn(database, 'createTransaction').mockImplementation(async (storeNames, mode) => {
      const transaction = await createTransaction(storeNames, mode);
      transaction.addEventListener('complete', () => {
        committed = true;
      });
      return transaction;
    });
    vi.mocked(activity.publish).mockImplementation(() => {
      committedWhenPublished = committed;
    });

    await expect(compact()).resolves.toBe('compacted');

    expect(committedWhenPublished).toBe(true);
  });

  it('faz rollback integral quando um put no receipt store falha', async () => {
    await seedClosedAggregate();
    const probe = await database.createTransaction([SYNC_RECEIPTS_STORE], 'readonly');
    const receiptStore = probe.objectStore(SYNC_RECEIPTS_STORE);
    const objectStorePrototype = Object.getPrototypeOf(receiptStore) as IDBObjectStore;
    const originalPut = objectStorePrototype.put;
    await transactionComplete(probe);
    let receiptPuts = 0;
    vi.spyOn(objectStorePrototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === SYNC_RECEIPTS_STORE && ++receiptPuts === 2) {
        throw new DOMException('receipt put failure', 'QuotaExceededError');
      }
      return key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
    });

    await expect(compact()).rejects.toThrow();

    expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(3);
    expect(await readStore<LocalRecord<JsonValue>>(LOCAL_RECORDS_STORE)).toHaveLength(3);
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
    expect(activity.publish).not.toHaveBeenCalled();
  });

  it('faz rollback integral quando a transação aborta assincronamente após enfileirar mutações', async () => {
    await seedClosedAggregate();
    const probe = await database.createTransaction([SYNC_RECEIPTS_STORE], 'readonly');
    const receiptStore = probe.objectStore(SYNC_RECEIPTS_STORE);
    const objectStorePrototype = Object.getPrototypeOf(receiptStore) as IDBObjectStore;
    const originalPut = objectStorePrototype.put;
    await transactionComplete(probe);
    let receiptPuts = 0;
    vi.spyOn(objectStorePrototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request =
        key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key);
      if (this.name === SYNC_RECEIPTS_STORE && ++receiptPuts === 3) {
        queueMicrotask(() => this.transaction.abort());
      }
      return request;
    });

    await expect(compact()).rejects.toEqual(expect.objectContaining({ code: 'ABORTED' }));

    expect(await readStore<OutboxEntry<JsonValue>>(OUTBOX_STORE)).toHaveLength(3);
    expect(await readStore<LocalRecord<JsonValue>>(LOCAL_RECORDS_STORE)).toHaveLength(3);
    expect(await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).toHaveLength(0);
    expect(receiptPuts).toBe(3);
    expect(activity.publish).not.toHaveBeenCalled();
  });

  it('poda somente recibos expirados do owner, incluindo o limite exato de expiração', async () => {
    await seedReceipts([
      receiptRecord(
        'expired-before',
        OWNER,
        '2026-08-01T00:00:00.000Z',
        '2026-08-27T23:59:59.000Z',
      ),
      receiptRecord('expired-now', OWNER, '2026-08-02T00:00:00.000Z', ARCHIVED_AT),
      receiptRecord('retained', OWNER, '2026-08-03T00:00:00.000Z', '2026-08-29T00:00:00.000Z'),
      receiptRecord(
        'foreign-expired',
        OTHER_OWNER,
        '2026-08-04T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ),
    ]);

    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 10)).resolves.toBe(2);

    expect(
      (await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).map((item) => item.localId).sort(),
    ).toEqual(['foreign-expired', 'retained']);
  });

  it('mantém os recibos mais recentes até o limite do owner', async () => {
    await seedReceipts([
      receiptRecord('oldest', OWNER, '2026-08-01T00:00:00.000Z'),
      receiptRecord('middle', OWNER, '2026-08-02T00:00:00.000Z'),
      receiptRecord('newest', OWNER, '2026-08-03T00:00:00.000Z'),
      receiptRecord('foreign', OTHER_OWNER, '2026-07-01T00:00:00.000Z'),
    ]);

    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 2)).resolves.toBe(1);

    expect(
      (await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).map((item) => item.localId).sort(),
    ).toEqual(['foreign', 'middle', 'newest']);
  });

  it('desempata archivedAt por localId descendente antes de aplicar o limite', async () => {
    await seedReceipts([
      receiptRecord('tie-a', OWNER, '2026-08-03T00:00:00.000Z'),
      receiptRecord('tie-c', OWNER, '2026-08-03T00:00:00.000Z'),
      receiptRecord('tie-b', OWNER, '2026-08-03T00:00:00.000Z'),
    ]);

    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 2)).resolves.toBe(1);

    expect(
      (await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).map((item) => item.localId).sort(),
    ).toEqual(['tie-b', 'tie-c']);
  });

  it('aplica o limite efetivo de 500 quando o owner possui 501 recibos', async () => {
    const records = Array.from({ length: 501 }, (_, index) =>
      receiptRecord(
        `receipt-${index.toString().padStart(3, '0')}`,
        OWNER,
        new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      ),
    );
    await seedReceipts(records);

    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 500)).resolves.toBe(1);

    const retainedIds = (await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).map(
      (item) => item.localId,
    );
    expect(retainedIds).toHaveLength(500);
    expect(retainedIds).not.toContain('receipt-000');
    expect(retainedIds).toContain('receipt-001');
    expect(retainedIds).toContain('receipt-500');
  });

  it('poda a união de expirados e excedentes sem contar o mesmo recibo duas vezes', async () => {
    await seedReceipts([
      receiptRecord(
        'newest-expired',
        OWNER,
        '2026-08-04T00:00:00.000Z',
        '2026-08-01T00:00:00.000Z',
      ),
      receiptRecord('second', OWNER, '2026-08-03T00:00:00.000Z'),
      receiptRecord('third', OWNER, '2026-08-02T00:00:00.000Z'),
      receiptRecord('oldest', OWNER, '2026-08-01T00:00:00.000Z'),
    ]);

    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 2)).resolves.toBe(3);

    expect(
      (await readStore<SyncReceiptRecord>(SYNC_RECEIPTS_STORE)).map((item) => item.localId),
    ).toEqual(['second']);
  });

  it('rejeita owner vazio e limite que não seja inteiro positivo antes de abrir transação', async () => {
    const createTransaction = vi.spyOn(database, 'createTransaction');

    await expect(repository.pruneReceipts('   ', ARCHIVED_AT, 10)).rejects.toEqual(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }),
    );
    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 0)).rejects.toBeInstanceOf(TypeError);
    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, -1)).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 1.5)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it('aborta e consome a conclusão quando getAll falha assincronamente', async () => {
    await seedReceipts([receiptRecord('retained', OWNER, '2026-08-03T00:00:00.000Z')]);
    const probe = await database.createTransaction([SYNC_RECEIPTS_STORE], 'readonly');
    const index = probe.objectStore(SYNC_RECEIPTS_STORE).index('ownerId');
    const indexPrototype = Object.getPrototypeOf(index) as IDBIndex;
    const transactionPrototype = Object.getPrototypeOf(probe) as IDBTransaction;
    const originalGetAll = indexPrototype.getAll;
    const abortSpy = vi.spyOn(transactionPrototype, 'abort');
    await transactionComplete(probe);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    vi.spyOn(indexPrototype, 'getAll').mockImplementation(function (
      this: IDBIndex,
      query?: IDBValidKey | IDBKeyRange | null,
      count?: number,
    ) {
      const request =
        count === undefined
          ? query === undefined
            ? originalGetAll.call(this)
            : originalGetAll.call(this, query)
          : originalGetAll.call(this, query, count);
      if (this.objectStore.name === SYNC_RECEIPTS_STORE && this.name === 'ownerId') {
        queueMicrotask(() => this.objectStore.transaction.abort());
      }
      return request;
    });

    try {
      await expect(repository.pruneReceipts(OWNER, ARCHIVED_AT, 500)).rejects.toEqual(
        expect.objectContaining({ code: 'ABORTED' }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(abortSpy).toHaveBeenCalledTimes(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  function compact(): Promise<'compacted' | 'ineligible'> {
    return repository.compactClosedAggregate(
      OWNER,
      AGGREGATE_TYPE,
      AGGREGATE_ID,
      ARCHIVED_AT,
      EXPIRES_AT,
    );
  }

  async function seedClosedAggregate(
    options: {
      readonly reportStatus?: OutboxEntry['status'];
      readonly reportHasReceipt?: boolean;
      readonly reportDeliveryDisposition?: 'SUPERSEDED' | 'ABANDONED';
    } = {},
  ): Promise<void> {
    await seedAggregate([
      outboxEntry(START_LOCAL_ID, 'START_OPERATION'),
      outboxEntry(REPORT_LOCAL_ID, 'REPORT_OPERATION', {
        status: options.reportStatus ?? 'SYNCED',
        includeReceipt: options.reportHasReceipt ?? true,
        deliveryDisposition: options.reportDeliveryDisposition,
      }),
      outboxEntry(END_LOCAL_ID, 'END_OPERATION'),
    ]);
  }

  async function seedActiveAggregate(): Promise<void> {
    await seedAggregate([
      outboxEntry(START_LOCAL_ID, 'START_OPERATION'),
      outboxEntry(REPORT_LOCAL_ID, 'REPORT_OPERATION'),
    ]);
  }

  async function seedAggregate(entries: readonly OutboxEntry<JsonValue>[]): Promise<void> {
    const transaction = await database.createTransaction(
      [LOCAL_RECORDS_STORE, OUTBOX_STORE],
      'readwrite',
    );
    const completed = transactionComplete(transaction);
    const localStore = transaction.objectStore(LOCAL_RECORDS_STORE);
    const outboxStore = transaction.objectStore(OUTBOX_STORE);
    for (const entry of entries) {
      localStore.add(localRecord(entry));
      outboxStore.add(entry);
    }
    await completed;
  }

  async function seedDependentCommand(options: {
    readonly status: OutboxEntry['status'];
    readonly deliveryDisposition?: 'SUPERSEDED' | 'ABANDONED';
  }): Promise<void> {
    const dependent = outboxEntry('dependent-command', 'REPORT_SCRAP', {
      status: options.status,
      aggregateType: 'SCRAP_REPORT',
      aggregateId: 'scrap-1',
      dependencyIds: [REPORT_LOCAL_ID],
      deliveryDisposition: options.deliveryDisposition,
    });
    await seedAggregate([dependent]);
  }

  async function seedReceipts(records: readonly SyncReceiptRecord[]): Promise<void> {
    const transaction = await database.createTransaction([SYNC_RECEIPTS_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(SYNC_RECEIPTS_STORE);
    for (const record of records) store.add(record);
    await completed;
  }

  async function readStore<T>(storeName: typeof LOCAL_RECORDS_STORE): Promise<T[]>;
  async function readStore<T>(storeName: typeof OUTBOX_STORE): Promise<T[]>;
  async function readStore<T>(storeName: typeof SYNC_RECEIPTS_STORE): Promise<T[]>;
  async function readStore<T>(
    storeName: typeof LOCAL_RECORDS_STORE | typeof OUTBOX_STORE | typeof SYNC_RECEIPTS_STORE,
  ): Promise<T[]> {
    const transaction = await database.createTransaction([storeName], 'readonly');
    const completed = transactionComplete(transaction);
    const records = await requestResult<T[]>(
      transaction.objectStore(storeName).getAll(),
      `Não foi possível ler ${storeName} no teste.`,
    );
    await completed;
    return records;
  }
});

function outboxEntry(
  localId: string,
  commandType: string,
  options: {
    readonly status?: OutboxEntry['status'];
    readonly includeReceipt?: boolean;
    readonly aggregateType?: string;
    readonly aggregateId?: string;
    readonly dependencyIds?: readonly string[];
    readonly deliveryDisposition?: 'SUPERSEDED' | 'ABANDONED';
  } = {},
): OutboxEntry<JsonValue> {
  const status = options.status ?? 'SYNCED';
  const synchronized = status === 'SYNCED';
  return {
    localId,
    idempotencyKey: `idempotency-${localId}`,
    payloadSchemaVersion: 1,
    aggregateType: options.aggregateType ?? AGGREGATE_TYPE,
    aggregateId: options.aggregateId ?? AGGREGATE_ID,
    commandType,
    payload: { localId },
    canonicalPayload: JSON.stringify({ localId }),
    payloadHash: `hash-${localId}`,
    ownerId: OWNER,
    status,
    dependencyIds: options.dependencyIds ?? [],
    attemptCount: synchronized ? 1 : 0,
    occurredAt: '2026-07-29T12:00:00.000Z',
    createdAt: `2026-07-29T12:00:0${localId === START_LOCAL_ID ? 0 : localId === REPORT_LOCAL_ID ? 1 : 2}.000Z`,
    updatedAt: SYNCHRONIZED_AT,
    ...(synchronized ? { synchronizedAt: SYNCHRONIZED_AT } : {}),
    ...(synchronized && options.includeReceipt !== false ? { receipt: receipt(localId) } : {}),
    ...(options.deliveryDisposition ? { deliveryDisposition: options.deliveryDisposition } : {}),
  };
}

function localRecord(entry: OutboxEntry<JsonValue>): LocalRecord<JsonValue> {
  return {
    localId: entry.localId,
    idempotencyKey: entry.idempotencyKey,
    databaseVersion: 4,
    payloadSchemaVersion: entry.payloadSchemaVersion,
    aggregateType: entry.aggregateType,
    aggregateId: entry.aggregateId,
    commandType: entry.commandType,
    payload: entry.payload,
    canonicalPayload: entry.canonicalPayload,
    payloadHash: entry.payloadHash,
    ownerId: entry.ownerId,
    dependencyIds: entry.dependencyIds,
    occurredAt: entry.occurredAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.deliveryDisposition ? { deliveryDisposition: entry.deliveryDisposition } : {}),
  };
}

function receipt(localId: string): RemoteCommandReceipt {
  return {
    serverRecordId: `server-${localId}`,
    receivedAt: SYNCHRONIZED_AT,
    processedAt: SYNCHRONIZED_AT,
    duplicate: false,
  };
}

function receiptRecord(
  localId: string,
  ownerId: string,
  archivedAt: string,
  expiresAt = '2026-10-01T00:00:00.000Z',
): SyncReceiptRecord {
  return {
    localId,
    ownerId,
    idempotencyKey: `idempotency-${localId}`,
    aggregateType: AGGREGATE_TYPE,
    aggregateId: `${AGGREGATE_ID}-${localId}`,
    commandType: 'REPORT_OPERATION',
    status: 'SYNCED',
    occurredAt: archivedAt,
    createdAt: archivedAt,
    synchronizedAt: archivedAt,
    archivedAt,
    expiresAt,
    receipt: receipt(localId),
  };
}
