import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('mantém listeners e intervalo parados enquanto não existe sessão autenticada', () => {
    const start = vi.spyOn(trigger, 'start');
    const stop = vi.spyOn(trigger, 'stop');
    const coordinator = createCoordinator(successTransport([]));

    coordinator.start();
    expect(start).not.toHaveBeenCalled();

    authenticate();
    expect(start).toHaveBeenCalledOnce();

    auth.logout();
    expect(stop).toHaveBeenCalledTimes(3);
  });

  it('preserva owner offline válido, mas mantém transporte e gatilhos pausados sem credencial', async () => {
    sessionStorage.clear();
    const clock = () => new Date('2026-07-29T13:00:00.000Z');
    const onlineAuth = new AuthSessionService(sessionStorage, clock);
    onlineAuth.startSession(user(), 'memory-only', {
      expiresAt: '2026-07-29T21:00:00.000Z',
    }, {
      expiresAt: '2026-07-29T21:00:00.000Z',
    });
    auth = new AuthSessionService(sessionStorage, clock);
    await seed(database, [entry('offline-command')]);
    const sent: string[] = [];
    const start = vi.spyOn(trigger, 'start');
    const coordinator = createCoordinator(successTransport(sent));

    coordinator.start();
    await coordinator.requestSync();

    expect(auth.mode).toBe('OFFLINE');
    expect(auth.currentUser?.id).toBe(OWNER);
    expect(start).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(await repository.getById(OWNER, 'offline-command')).toMatchObject({
      status: 'PENDING',
    });
  });

  it('não envia claim obtido depois de logout e o devolve para PENDING', async () => {
    await seed(database, [entry('command')]);
    let releaseClaim = () => undefined;
    let claimed = () => undefined;
    const claimReached = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const originalClaim = repository.claim.bind(repository);
    vi.spyOn(repository, 'claim').mockImplementation(async (request) => {
      const result = await originalClaim(request);
      claimed();
      await claimGate;
      return result;
    });
    const sent: string[] = [];
    const coordinator = createCoordinator(successTransport(sent));
    authenticate();
    coordinator.start();

    const processing = coordinator.requestSync();
    await claimReached;
    auth.logout();
    releaseClaim();
    await processing;

    expect(sent).toEqual([]);
    expect(await repository.getById(OWNER, 'command')).toMatchObject({ status: 'PENDING' });
  });

  it('aborta envio em andamento no logout e libera o claim com fencing', async () => {
    await seed(database, [entry('command')]);
    let transportStarted = () => undefined;
    const started = new Promise<void>((resolve) => {
      transportStarted = resolve;
    });
    let aborted = false;
    const coordinator = createCoordinator({
      send: (_request, signal) =>
        new Promise((_resolve, reject) => {
          transportStarted();
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });
    authenticate();
    coordinator.start();

    const processing = coordinator.requestSync();
    await started;
    auth.logout();
    await processing;

    expect(aborted).toBe(true);
    expect(await repository.getById(OWNER, 'command')).toMatchObject({ status: 'PENDING' });
  });

  it('reagenda imediatamente o claim abortado quando o mesmo owner renova a sessão', async () => {
    await seed(database, [entry('command')]);
    let sends = 0;
    let firstStarted = () => undefined;
    const started = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const coordinator = createCoordinator({
      send: (request, signal) => {
        sends += 1;
        if (sends === 1) {
          firstStarted();
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        return Promise.resolve({
          serverRecordId: 'server-command',
          idempotencyKey: request.idempotencyKey,
          receivedAt: NOW,
          processedAt: NOW,
          duplicate: true,
        });
      },
    });
    authenticate();
    coordinator.start();

    const processing = coordinator.requestSync();
    await started;
    auth.startSession(user(), 'renewed-memory-token', { expiresAt: '2099-01-01T00:00:00.000Z' });
    await processing;
    await eventually(() => sends === 2);

    expect(await repository.getById(OWNER, 'command')).toMatchObject({ status: 'SYNCED' });
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
    firstAuth.startSession(user(), 'first-memory-token', { expiresAt: '2099-01-01T00:00:00.000Z' });
    secondAuth.startSession(user(), 'second-memory-token', { expiresAt: '2099-01-01T00:00:00.000Z' });
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

    auth.startSession(user(), 'renewed-memory-token', { expiresAt: '2099-01-01T00:00:00.000Z' });
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
    expect(await coordinator.retryError('command')).toBe('queued');
    expect(await repository.getById(OWNER, 'command')).toMatchObject({
      status: 'PENDING',
      manualRetryCount: 1,
    });
    await eventually(() => sends === 2);
    const after = await repository.getById(OWNER, 'command');
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

  it('retorna resultado discriminado sem alterar ERROR quando falta credencial remota', async () => {
    await seed(database, [entry('command', { status: 'ERROR' })]);
    const coordinator = createCoordinator(successTransport([]));
    coordinator.start();

    expect(await coordinator.retryError('command')).toBe('no-credential');
    expect(await repository.getById(OWNER, 'command')).toMatchObject({ status: 'ERROR' });
  });

  it('classifica race de sessão e falha de storage no retry manual', async () => {
    await seed(database, [entry('command', { status: 'ERROR' })]);
    const coordinator = createCoordinator(successTransport([]));
    authenticate();
    coordinator.start();
    const originalRetry = repository.retryError.bind(repository);
    vi.spyOn(repository, 'retryError').mockImplementationOnce(async (...args) => {
      auth.logout();
      return originalRetry(...args);
    });

    expect(await coordinator.retryError('command')).toBe('stale-or-ineligible');

    authenticate();
    vi.spyOn(repository, 'retryError').mockRejectedValueOnce(new Error('storage'));
    expect(await coordinator.retryError('command')).toBe('storage-error');
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

  it('aguarda todos os workers antes de propagar uma falha e liberar o single-flight', async () => {
    await seed(database, [
      entry('a', { aggregateId: 'A' }),
      entry('b', { aggregateId: 'B' }),
    ]);
    let releaseB = () => undefined;
    let bStarted = () => undefined;
    const bGate = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    const bWasStarted = new Promise<void>((resolve) => {
      bStarted = resolve;
    });
    const originalReconcileFailure = repository.reconcileFailure.bind(repository);
    vi.spyOn(repository, 'reconcileFailure').mockImplementation((request) =>
      request.localId === 'a'
        ? Promise.reject(new Error('falha IndexedDB'))
        : originalReconcileFailure(request),
    );
    const coordinator = createCoordinator({
      send: async (request) => {
        if (request.localId === 'a') {
          throw new TypeError('network');
        }
        bStarted();
        await bGate;
        return {
          serverRecordId: 'server-b',
          idempotencyKey: request.idempotencyKey,
          receivedAt: NOW,
          processedAt: NOW,
          duplicate: false,
        };
      },
    });
    authenticate();
    coordinator.start();
    let settled = false;

    const processing = coordinator.requestSync().then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await bWasStarted;
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseB();
    await processing;
    expect(settled).toBe(true);
  });

  it('rejeita configuração cujo lease não ultrapassa o timeout antes de iniciar', () => {
    const coordinator = createCoordinator(successTransport([]), {
      requestTimeoutMs: 60_000,
      leaseDurationMs: 60_000,
    });

    expect(() => coordinator.start()).toThrowError(/scheduler/i);
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
    auth.startSession(user(), 'token-memory-only', { expiresAt: '2099-01-01T00:00:00.000Z' });
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
