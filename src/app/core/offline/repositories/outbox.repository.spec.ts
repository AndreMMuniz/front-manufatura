import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from '../database/offline-database';
import { OUTBOX_STORE } from '../database/database-schema';
import { JsonValue } from '../models/local-record';
import { OutboxEntry } from '../models/outbox-entry';
import { transactionComplete } from './repository-utils';
import { OutboxRepository } from './outbox.repository';

const OWNER = 'operator-1';
const OTHER_OWNER = 'operator-2';
const NOW = '2026-07-29T13:00:00.000Z';
const LEASE_EXPIRES = '2026-07-29T13:01:00.000Z';

describe('OutboxRepository processing', () => {
  let database: OfflineDatabase;
  let repository: OutboxRepository;

  beforeEach(() => {
    database = new OfflineDatabase(() => new IDBFactory(), OFFLINE_DATABASE_CONFIG);
    repository = new OutboxRepository(database);
  });

  it('seleciona cabeças elegíveis, faz claim CAS e só devolve após o commit', async () => {
    await seed(database, [
      entry('first', { createdAt: '2026-07-29T12:00:00.000Z' }),
      entry('second', { createdAt: '2026-07-29T12:01:00.000Z' }),
      entry('parallel', { aggregateId: 'OP-2' }),
      entry('foreign', { ownerId: OTHER_OWNER, aggregateId: 'OP-3' }),
    ]);

    const candidates = await repository.listCandidates(OWNER, NOW, 10);
    const first = candidates.find((candidate) => candidate.localId === 'first')!;
    const claimed = await repository.claim({
      ownerId: OWNER,
      localId: first.localId,
      leaseToken: 'lease-a',
      now: NOW,
      leaseExpiresAt: LEASE_EXPIRES,
    });

    expect(candidates.map((candidate) => candidate.localId)).toEqual(['first', 'parallel']);
    expect(claimed).toMatchObject({
      localId: 'first',
      status: 'SYNCING',
      attemptCount: 1,
      leaseToken: 'lease-a',
      leaseExpiresAt: LEASE_EXPIRES,
      lastAttemptAt: NOW,
    });
    expect(await repository.getById(OWNER, 'first')).toEqual(claimed);
    expect(await repository.getById(OTHER_OWNER, 'first')).toBeNull();
  });

  it('permite somente um vencedor concorrente e não rouba lease ativo', async () => {
    await seed(database, [entry('command')]);

    const [first, second] = await Promise.all([
      repository.claim(claim('command', 'lease-a')),
      repository.claim(claim('command', 'lease-b')),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((await repository.getById(OWNER, 'command'))?.attemptCount).toBe(1);
  });

  it('recupera lease vencido com novo fencing token e ignora resposta tardia', async () => {
    await seed(database, [
      entry('command', {
        status: 'SYNCING',
        attemptCount: 1,
        leaseToken: 'stale',
        leaseExpiresAt: '2026-07-29T12:59:59.000Z',
      }),
    ]);

    const takeover = await repository.claim(claim('command', 'fresh'));
    const staleApplied = await repository.reconcileSuccess({
      ownerId: OWNER,
      localId: 'command',
      leaseToken: 'stale',
      now: NOW,
      result: receipt('command'),
    });
    const freshApplied = await repository.reconcileSuccess({
      ownerId: OWNER,
      localId: 'command',
      leaseToken: 'fresh',
      now: NOW,
      result: receipt('command'),
    });

    expect(takeover).toMatchObject({ attemptCount: 2, leaseToken: 'fresh' });
    expect(staleApplied).toBe(false);
    expect(freshApplied).toBe(true);
    expect(await repository.getById(OWNER, 'command')).toMatchObject({
      status: 'SYNCED',
      synchronizedAt: NOW,
      receipt: { serverRecordId: 'server-command' },
    });
  });

  it('recupera claim após crash/reload com repository e conexão recriados', async () => {
    const factory = new IDBFactory();
    const firstDatabase = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    const firstRepository = new OutboxRepository(firstDatabase);
    await seed(firstDatabase, [
      entry('command', {
        status: 'SYNCING',
        attemptCount: 1,
        leaseToken: 'crashed-tab',
        leaseExpiresAt: '2026-07-29T12:59:59.000Z',
      }),
    ]);
    firstDatabase.close();

    const recoveredDatabase = new OfflineDatabase(() => factory, OFFLINE_DATABASE_CONFIG);
    const recoveredRepository = new OutboxRepository(recoveredDatabase);
    const claimed = await recoveredRepository.claim({
      ...claim('command', 'reloaded-tab'),
    });

    expect(claimed).toMatchObject({
      status: 'SYNCING',
      attemptCount: 2,
      leaseToken: 'reloaded-tab',
    });
  });

  it('bloqueia dependência pendente ou ausente e reavalia quando concluída', async () => {
    await seed(database, [
      entry('dependency'),
      entry('dependent', {
        aggregateId: 'OP-2',
        dependencyIds: ['dependency'],
      }),
      entry('missing', {
        aggregateId: 'OP-3',
        dependencyIds: ['does-not-exist'],
      }),
    ]);

    expect(await repository.claim(claim('dependent', 'dependent-lease'))).toBeNull();
    expect(await repository.claim(claim('missing', 'missing-lease'))).toBeNull();
    expect(await repository.getById(OWNER, 'dependent')).toMatchObject({
      status: 'BLOCKED_DEPENDENCY',
    });
    expect(await repository.getById(OWNER, 'missing')).toMatchObject({
      status: 'BLOCKED_DEPENDENCY',
      lastError: { code: 'DEPENDENCY_MISSING', category: 'CONFIGURATION' },
    });

    await repository.claim(claim('dependency', 'dependency-lease'));
    await repository.reconcileSuccess({
      ownerId: OWNER,
      localId: 'dependency',
      leaseToken: 'dependency-lease',
      now: NOW,
      result: receipt('dependency'),
    });

    expect(await repository.claim(claim('dependent', 'dependent-lease-2'))).toMatchObject({
      status: 'SYNCING',
    });
  });

  it('não deixa item posterior ultrapassar a primeira cabeça não terminal do agregado', async () => {
    await seed(database, [
      entry('first', {
        status: 'ERROR',
        createdAt: '2026-07-29T12:00:00.000Z',
      }),
      entry('second', { createdAt: '2026-07-29T12:01:00.000Z' }),
    ]);

    expect(await repository.listCandidates(OWNER, NOW, 10)).toEqual([]);
    expect(await repository.claim(claim('second', 'lease'))).toBeNull();
    expect(await repository.getById(OWNER, 'second')).toMatchObject({
      status: 'BLOCKED_DEPENDENCY',
    });
  });

  it('reconcilia falhas owner-scoped, libera lease e preserva conteúdo imutável', async () => {
    await seed(database, [entry('command')]);
    const before = await repository.getById(OWNER, 'command');
    await repository.claim(claim('command', 'lease'));

    expect(
      await repository.reconcileFailure({
        ownerId: OWNER,
        localId: 'command',
        leaseToken: 'lease',
        now: NOW,
        status: 'RETRY_WAIT',
        nextAttemptAt: '2026-07-29T13:00:10.000Z',
        error: {
          code: 'NETWORK',
          category: 'TRANSIENT',
          userMessage: 'Serviço temporariamente indisponível.',
        },
      }),
    ).toBe(true);
    const after = await repository.getById(OWNER, 'command');

    expect(after).toMatchObject({
      status: 'RETRY_WAIT',
      nextAttemptAt: '2026-07-29T13:00:10.000Z',
      lastError: { code: 'NETWORK' },
    });
    expect(after).not.toHaveProperty('leaseToken');
    expect(after).not.toHaveProperty('leaseExpiresAt');
    expect(identity(after!)).toEqual(identity(before!));
  });

  it('reabilita ERROR somente por operação manual e BLOCKED_AUTH apenas no owner correto', async () => {
    await seed(database, [
      entry('error', {
        status: 'ERROR',
        lastError: {
          code: 'VALIDATION',
          category: 'VALIDATION',
          userMessage: 'Comando inválido.',
        },
      }),
      entry('auth', {
        status: 'BLOCKED_AUTH',
        lastError: {
          code: 'UNAUTHORIZED',
          category: 'AUTH',
          userMessage: 'Sessão expirada.',
        },
      }),
    ]);
    const errorIdentity = identity((await repository.getById(OWNER, 'error'))!);

    expect(await repository.retryError(OTHER_OWNER, 'error', NOW)).toBe(false);
    expect(await repository.retryError(OWNER, 'error', NOW)).toBe(true);
    expect(await repository.resumeBlockedAuth(OTHER_OWNER, NOW)).toBe(0);
    expect(await repository.resumeBlockedAuth(OWNER, NOW)).toBe(1);

    expect(await repository.getById(OWNER, 'error')).toMatchObject({ status: 'PENDING' });
    expect(identity((await repository.getById(OWNER, 'error'))!)).toEqual(errorIdentity);
    expect(await repository.getById(OWNER, 'auth')).toMatchObject({ status: 'PENDING' });
  });
});

function claim(localId: string, leaseToken: string) {
  return {
    ownerId: OWNER,
    localId,
    leaseToken,
    now: NOW,
    leaseExpiresAt: LEASE_EXPIRES,
  };
}

function receipt(localId: string) {
  return {
    serverRecordId: `server-${localId}`,
    idempotencyKey: localId,
    receivedAt: NOW,
    processedAt: NOW,
    duplicate: false,
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

function identity(entryValue: OutboxEntry<JsonValue>) {
  return {
    idempotencyKey: entryValue.idempotencyKey,
    canonicalPayload: entryValue.canonicalPayload,
    payload: entryValue.payload,
    payloadHash: entryValue.payloadHash,
  };
}

async function seed(database: OfflineDatabase, entries: readonly OutboxEntry<JsonValue>[]) {
  const transaction = await database.createTransaction([OUTBOX_STORE], 'readwrite');
  const completed = transactionComplete(transaction);
  for (const entryValue of entries) {
    transaction.objectStore(OUTBOX_STORE).add(entryValue);
  }
  await completed;
}
