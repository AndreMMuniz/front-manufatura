import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { AuthSessionService } from '../../auth/auth-session.service';
import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from '../database/offline-database';
import { OUTBOX_STORE } from '../database/database-schema';
import { JsonValue } from '../models/local-record';
import { OutboxEntry } from '../models/outbox-entry';
import { DEFAULT_SYNC_SCHEDULER_CONFIG } from '../models/sync-error';
import { OutboxRepository } from '../repositories/outbox.repository';
import { transactionComplete } from '../repositories/repository-utils';
import { IdempotencyService } from './idempotency.service';
import { SyncCoordinatorService } from './sync-coordinator.service';
import { SyncTransport, TimeoutScheduler } from './sync-transport';
import { SyncTriggerReason, SyncTriggerService } from './sync-trigger.service';

const NOW = '2026-07-29T13:00:00.000Z';
const OWNER = 'operator-1';

describe('SyncCoordinatorService', () => {
  let database: OfflineDatabase;
  let repository: OutboxRepository;
  let auth: AuthSessionService;
  let triggerCallback: ((reason: SyncTriggerReason) => void) | undefined;
  let trigger: SyncTriggerService;
  let uuidIndex: number;
  let currentTime: string;

  beforeEach(() => {
    database = new OfflineDatabase(() => new IDBFactory(), OFFLINE_DATABASE_CONFIG);
    repository = new OutboxRepository(database);
    auth = new AuthSessionService();
    auth.logout();
    trigger = {
      start: (callback: (reason: SyncTriggerReason) => void) => {
        triggerCallback = callback;
      },
      stop: () => undefined,
      requestSync: () => triggerCallback?.('manual'),
    } as SyncTriggerService;
    uuidIndex = 0;
    currentTime = NOW;
  });

  it('serializa um agregado, paraleliza agregados independentes e limita concorrência', async () => {
    await seed(database, [
      entry('a-1', { aggregateId: 'A', createdAt: '2026-07-29T12:00:00.000Z' }),
      entry('a-2', { aggregateId: 'A', createdAt: '2026-07-29T12:01:00.000Z' }),
      entry('b-1', { aggregateId: 'B' }),
      entry('c-1', { aggregateId: 'C' }),
    ]);
    const sent: string[] = [];
    let active = 0;
    let maxActive = 0;
    let releaseParallel = () => undefined;
    const parallelGate = new Promise<void>((resolve) => {
      releaseParallel = resolve;
    });
    const transport: SyncTransport = {
      send: async (request) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        sent.push(request.localId);
        if (active === 2) {
          releaseParallel();
        }
        await parallelGate;
        active -= 1;
        return {
          serverRecordId: `server-${request.localId}`,
          idempotencyKey: request.idempotencyKey,
          receivedAt: NOW,
          processedAt: NOW,
          duplicate: false,
        };
      },
    };
    const coordinator = createCoordinator(transport, { concurrency: 2 });
    authenticate();

    coordinator.start();
    await coordinator.requestSync();

    expect(maxActive).toBe(2);
    expect(sent.indexOf('a-1')).toBeLessThan(sent.indexOf('a-2'));
    expect((await repository.listByOwner(OWNER)).every((item) => item.status === 'SYNCED')).toBe(
      true,
    );
  });

  it('coalesce gatilhos simultâneos em single-flight sem envio duplicado', async () => {
    await seed(database, [entry('command')]);
    let release = () => undefined;
    let sends = 0;
    const transport: SyncTransport = {
      send: async (request) => {
        sends += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          serverRecordId: 'server-command',
          idempotencyKey: request.idempotencyKey,
          receivedAt: NOW,
          processedAt: NOW,
          duplicate: false,
        };
      },
    };
    const coordinator = createCoordinator(transport);
    authenticate();
    coordinator.start();

    const first = coordinator.requestSync();
    const second = coordinator.requestSync();
    triggerCallback?.('online');
    triggerCallback?.('interval');
    await eventually(() => sends === 1);
    expect(sends).toBe(1);
    release();
    await Promise.all([first, second]);
    expect(sends).toBe(1);
  });

  it('processa somente owner autenticado, pausa no logout e retoma BLOCKED_AUTH no mesmo owner', async () => {
    await seed(database, [
      entry('own', {
        status: 'BLOCKED_AUTH',
        lastError: {
          code: 'HTTP_401',
          category: 'AUTH',
          userMessage: 'Sessão expirada.',
        },
      }),
      entry('foreign', { ownerId: 'operator-2', aggregateId: 'B' }),
    ]);
    const sent: string[] = [];
    const transport = successTransport(sent);
    const coordinator = createCoordinator(transport);

    coordinator.start();
    await coordinator.requestSync();
    expect(sent).toEqual([]);

    authenticate();
    await coordinator.requestSync();
    expect(sent).toEqual(['own']);
    expect(await repository.getById('operator-2', 'foreign')).toMatchObject({ status: 'PENDING' });

    auth.logout();
    await coordinator.requestSync();
    expect(sent).toEqual(['own']);
  });

  it('trata onLine como sinal: falha de rede produz RETRY_WAIT, não SYNCED', async () => {
    await seed(database, [entry('command')]);
    const coordinator = createCoordinator({
      send: () => Promise.reject(new TypeError('Failed to fetch token=secret')),
    });
    authenticate();
    coordinator.start();

    triggerCallback?.('online');
    await coordinator.requestSync();

    expect(await repository.getById(OWNER, 'command')).toMatchObject({
      status: 'RETRY_WAIT',
      lastError: { code: 'NETWORK', category: 'TRANSIENT' },
    });
  });

  it('coordena duas instâncias na mesma IDBFactory com um único claim e envio', async () => {
    const factory = new IDBFactory();
    const firstDatabase = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    const secondDatabase = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    const firstRepository = new OutboxRepository(firstDatabase);
    const secondRepository = new OutboxRepository(secondDatabase);
    await seed(firstDatabase, [entry('shared-command')]);
    const firstAuth = new AuthSessionService();
    const secondAuth = new AuthSessionService();
    firstAuth.logout();
    secondAuth.logout();
    firstAuth.startSession(user(), 'first-memory-token');
    secondAuth.startSession(user(), 'second-memory-token');
    let sends = 0;
    const transport: SyncTransport = {
      send: async (request) => {
        sends += 1;
        return {
          serverRecordId: 'server-shared',
          idempotencyKey: request.idempotencyKey,
          receivedAt: NOW,
          processedAt: NOW,
          duplicate: false,
        };
      },
    };
    const first = isolatedCoordinator(firstRepository, firstAuth, transport, '10');
    const second = isolatedCoordinator(secondRepository, secondAuth, transport, '20');

    first.start();
    second.start();
    await Promise.all([first.requestSync(), second.requestSync()]);

    expect(sends).toBe(1);
    expect(await firstRepository.getById(OWNER, 'shared-command')).toMatchObject({
      status: 'SYNCED',
      attemptCount: 1,
    });
  });

  it('retoma BLOCKED_AUTH quando o mesmo owner renova a sessão', async () => {
    await seed(database, [entry('command')]);
    let sends = 0;
    const transport: SyncTransport = {
      send: async (request) => {
        sends += 1;
        if (sends === 1) {
          throw { status: 401 };
        }
        return {
          serverRecordId: 'server-command',
          idempotencyKey: request.idempotencyKey,
          receivedAt: NOW,
          processedAt: NOW,
          duplicate: false,
        };
      },
    };
    const coordinator = createCoordinator(transport);
    authenticate();
    coordinator.start();
    await coordinator.requestSync();
    expect(await repository.getById(OWNER, 'command')).toMatchObject({
      status: 'BLOCKED_AUTH',
    });

    auth.startSession(user(), 'renewed-memory-token');
    await eventually(() => sends === 2);

    expect(await repository.getById(OWNER, 'command')).toMatchObject({ status: 'SYNCED' });
  });

  it('não repete ERROR automaticamente e retry manual preserva identidade/conteúdo', async () => {
    await seed(database, [entry('command')]);
    const before = await repository.getById(OWNER, 'command');
    let accepts = false;
    let sends = 0;
    const transport: SyncTransport = {
      send: async (request) => {
        sends += 1;
        if (!accepts) {
          throw {
            status: 422,
            code: 'BUSINESS_RULE',
            category: 'VALIDATION',
            userMessage: 'Regra de negócio não atendida.',
          };
        }
        return {
          serverRecordId: 'server-command',
          idempotencyKey: request.idempotencyKey,
          receivedAt: NOW,
          processedAt: NOW,
          duplicate: false,
        };
      },
    };
    const coordinator = createCoordinator(transport);
    authenticate();
    coordinator.start();
    await coordinator.requestSync();
    triggerCallback?.('online');
    triggerCallback?.('interval');
    await coordinator.requestSync();

    expect(sends).toBe(1);
    expect(await repository.getById(OWNER, 'command')).toMatchObject({ status: 'ERROR' });

    accepts = true;
    await coordinator.retryError('command');
    const after = await repository.getById(OWNER, 'command');
    expect(sends).toBe(2);
    expect(after).toMatchObject({ status: 'SYNCED' });
    expect({
      idempotencyKey: after?.idempotencyKey,
      payloadHash: after?.payloadHash,
      canonicalPayload: after?.canonicalPayload,
      payload: after?.payload,
    }).toEqual({
      idempotencyKey: before?.idempotencyKey,
      payloadHash: before?.payloadHash,
      canonicalPayload: before?.canonicalPayload,
      payload: before?.payload,
    });
  });

  it('reenvia após falha transitória com chave e conteúdo exatamente iguais', async () => {
    await seed(database, [entry('command')]);
    const snapshots: string[] = [];
    const transport: SyncTransport = {
      send: async (request) => {
        snapshots.push(JSON.stringify(request));
        if (snapshots.length === 1) {
          throw new TypeError('Failed to fetch');
        }
        return {
          serverRecordId: 'server-command',
          idempotencyKey: request.idempotencyKey,
          receivedAt: currentTime,
          processedAt: currentTime,
          duplicate: true,
        };
      },
    };
    const coordinator = createCoordinator(transport);
    authenticate();
    coordinator.start();
    await coordinator.requestSync();
    currentTime = '2026-07-29T13:00:01.000Z';
    await coordinator.requestSync();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toBe(snapshots[0]);
    expect(await repository.getById(OWNER, 'command')).toMatchObject({ status: 'SYNCED' });
  });

  function createCoordinator(
    transport: SyncTransport,
    overrides: Partial<typeof DEFAULT_SYNC_SCHEDULER_CONFIG> = {},
  ): SyncCoordinatorService {
    const timeout: TimeoutScheduler = {
      schedule: () => () => undefined,
    };
    return new SyncCoordinatorService(
      repository,
      auth,
      trigger,
      transport,
      new IdempotencyService(() => ({
        randomUUID: () =>
          `123e4567-e89b-42d3-a456-4266141740${String(uuidIndex++).padStart(2, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
      })),
      () => new Date(currentTime),
      () => 0.5,
      { ...DEFAULT_SYNC_SCHEDULER_CONFIG, batchSize: 10, concurrency: 2, ...overrides },
      timeout,
    );
  }

  function authenticate(): void {
    auth.startSession(user(), 'token-memory-only');
  }
});

function isolatedCoordinator(
  repository: OutboxRepository,
  auth: AuthSessionService,
  transport: SyncTransport,
  uuidSuffix: string,
): SyncCoordinatorService {
  const trigger = {
    start: () => undefined,
    stop: () => undefined,
    requestSync: () => undefined,
  } as unknown as SyncTriggerService;
  return new SyncCoordinatorService(
    repository,
    auth,
    trigger,
    transport,
    new IdempotencyService(() => ({
      randomUUID: () =>
        `123e4567-e89b-42d3-a456-4266141740${uuidSuffix}` as `${string}-${string}-${string}-${string}-${string}`,
    })),
    () => new Date(NOW),
    () => 0.5,
    { ...DEFAULT_SYNC_SCHEDULER_CONFIG, batchSize: 10, concurrency: 2 },
    { schedule: () => () => undefined },
  );
}

function user() {
  return { id: OWNER, nome: 'Operador', login: 'operador', permissoes: [] };
}

function successTransport(sent: string[]): SyncTransport {
  return {
    send: async (request) => {
      sent.push(request.localId);
      return {
        serverRecordId: `server-${request.localId}`,
        idempotencyKey: request.idempotencyKey,
        receivedAt: NOW,
        processedAt: NOW,
        duplicate: false,
      };
    },
  };
}

function entry(
  localId: string,
  overrides: Partial<OutboxEntry<JsonValue>> = {},
): OutboxEntry<JsonValue> {
  return {
    localId,
    idempotencyKey: localId,
    payloadSchemaVersion: 1,
    aggregateType: 'REPORT',
    aggregateId: 'OP-1',
    commandType: 'CONFIRM_REPORT',
    payload: { quantity: 5 },
    canonicalPayload: '{"quantity":5}',
    payloadHash: `hash-${localId}`,
    ownerId: OWNER,
    status: 'PENDING',
    dependencyIds: [],
    attemptCount: 0,
    occurredAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
    ...overrides,
  };
}

async function seed(database: OfflineDatabase, entries: readonly OutboxEntry<JsonValue>[]) {
  const transaction = await database.createTransaction([OUTBOX_STORE], 'readwrite');
  const completed = transactionComplete(transaction);
  for (const value of entries) {
    transaction.objectStore(OUTBOX_STORE).add(value);
  }
  await completed;
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  }
  throw new Error('A condição assíncrona não foi atendida.');
}
