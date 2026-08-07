import { IDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OFFLINE_DATABASE_CONFIG, OfflineDatabase } from '../database/offline-database';
import { OUTBOX_STORE } from '../database/database-schema';
import { JsonValue } from '../models/local-record';
import { OutboxEntry } from '../models/outbox-entry';
import { transactionComplete } from './repository-utils';
import { OutboxRepository } from './outbox.repository';
import { SupervisorProofVault } from '../services/supervisor-proof-vault';
import { OutboxActivityService } from '../services/outbox-activity.service';

const OWNER = 'operator-1';
const OTHER_OWNER = 'operator-2';
const NOW = '2026-07-29T13:00:00.000Z';
const LEASE_EXPIRES = '2026-07-29T13:01:00.000Z';

describe('OutboxRepository processing', () => {
  let database: OfflineDatabase;
  let repository: OutboxRepository;
  let supervisorProofs: SupervisorProofVault;
  let activity: OutboxActivityService;

  beforeEach(() => {
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
    database = new OfflineDatabase(() => new IDBFactory(), OFFLINE_DATABASE_CONFIG);
    supervisorProofs = new SupervisorProofVault();
    activity = { publish: vi.fn() } as unknown as OutboxActivityService;
    repository = new OutboxRepository(database, supervisorProofs, activity);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pagina por cursor exclusivo owner/occurredAt/localId sem gap ou duplicata', async () => {
    await seed(database, [
      entry('a', { occurredAt: '2026-07-29T12:03:00.000Z' }),
      entry('b', { occurredAt: '2026-07-29T12:02:00.000Z' }),
      entry('c', { occurredAt: '2026-07-29T12:02:00.000Z' }),
      entry('d', { occurredAt: '2026-07-29T12:01:00.000Z' }),
      entry('foreign', {
        ownerId: OTHER_OWNER,
        occurredAt: '2026-07-29T12:04:00.000Z',
      }),
    ]);

    const first = await repository.listPage({ ownerId: OWNER, pageSize: 2 });
    const second = await repository.listPage({
      ownerId: OWNER,
      pageSize: 2,
      cursor: first.nextCursor!,
    });

    expect(first.items.map(item => item.localId)).toEqual(['a', 'c']);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toEqual({
      ownerId: OWNER,
      occurredAt: '2026-07-29T12:02:00.000Z',
      localId: 'c',
    });
    expect(second.items.map(item => item.localId)).toEqual(['b', 'd']);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map(item => item.localId)).size).toBe(4);
  });

  it('faz overfetch para filtros derivados e limita pageSize entre 1 e 100', async () => {
    await seed(database, Array.from({ length: 30 }, (_, index) => entry(`item-${index
      .toString()
      .padStart(2, '0')}`, {
      occurredAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
      payload: { ordem: index % 7 === 0 ? 'OP-ALVO' : `OP-${index}` },
    })));

    const page = await repository.listPage({
      ownerId: OWNER,
      pageSize: 3,
      matchesIdentification: candidate =>
        (candidate.payload as { ordem?: string }).ordem === 'OP-ALVO',
    });

    expect(page.items.map(item => item.localId)).toEqual(['item-00', 'item-07', 'item-14']);
    expect(page.hasMore).toBe(true);
    await expect(repository.listPage({ ownerId: OWNER, pageSize: 101 }))
      .rejects.toThrow(/100/);
  });

  it('calcula summary owner-scoped separado da página e ignora disposições terminais', async () => {
    await seed(database, [
      entry('pending'),
      entry('syncing', { status: 'SYNCING' }),
      entry('auth', { status: 'BLOCKED_AUTH' }),
      entry('error', { status: 'ERROR' }),
      entry('synced', { status: 'SYNCED', receipt: receipt('synced') }),
      entry('abandoned', {
        status: 'ERROR',
        deliveryDisposition: 'ABANDONED',
      } as Partial<OutboxEntry<JsonValue>>),
      entry('foreign', { ownerId: OTHER_OWNER, status: 'ERROR' }),
    ]);

    expect(await repository.summarizeOwner(OWNER)).toEqual({
      pending: 3,
      error: 1,
      syncing: 1,
      receipts: 1,
    });
  });

  it('separa filtros de status ativo das disposições históricas e normaliza legado futuro', async () => {
    await seed(database, [
      entry('active-error', { status: 'ERROR' }),
      entry('superseded-error', {
        status: 'ERROR',
        deliveryDisposition: 'SUPERSEDED',
      }),
      entry('future-disposition', {
        status: 'PENDING',
        deliveryDisposition: 'FUTURE' as never,
      }),
    ]);

    expect((await repository.listPage({
      ownerId: OWNER,
      statuses: ['ERROR'],
    })).items.map(item => item.localId)).toEqual(['active-error']);
    expect((await repository.listPage({
      ownerId: OWNER,
      statuses: ['SUPERSEDED'],
    })).items.map(item => item.localId)).toEqual(['superseded-error']);
    expect(await repository.summarizeOwner(OWNER)).toMatchObject({
      pending: 1,
      error: 1,
    });
  });

  it('ignora tombstones nos heads/candidates e posiciona o substituto antes da cauda', async () => {
    await seed(database, [
      entry('original', {
        status: 'ERROR',
        deliveryDisposition: 'SUPERSEDED',
        supersededByLocalId: 'replacement',
        occurredAt: '2026-07-29T12:00:00.000Z',
        createdAt: '2026-07-29T12:00:00.000Z',
      }),
      entry('replacement', {
        supersedesLocalId: 'original',
        logicalOccurredAt: '2026-07-29T12:00:00.000Z',
        occurredAt: '2026-07-29T12:10:00.000Z',
        createdAt: '2026-07-29T12:10:00.000Z',
      }),
      entry('tail', {
        occurredAt: '2026-07-29T12:01:00.000Z',
        createdAt: '2026-07-29T12:01:00.000Z',
      }),
      entry('abandoned', {
        aggregateId: 'ABANDONED',
        deliveryDisposition: 'ABANDONED',
      }),
    ]);

    expect((await repository.listCandidates(OWNER, NOW, 10)).map(item => item.localId))
      .toEqual(['replacement']);
    expect(await repository.retryError(OWNER, 'original', NOW)).toBe(false);
    expect(await repository.claim(claim('tail', 'tail-lease'))).toBeNull();
  });

  it('resolve dependência ao original SUPERSEDED somente após o substituto sincronizar', async () => {
    await seed(database, [
      entry('original', {
        aggregateId: 'ORIGINAL',
        status: 'ERROR',
        deliveryDisposition: 'SUPERSEDED',
        supersededByLocalId: 'replacement',
      }),
      entry('replacement', {
        aggregateId: 'ORIGINAL',
        supersedesLocalId: 'original',
      }),
      entry('dependent', {
        aggregateId: 'DEPENDENT',
        dependencyIds: ['original'],
      }),
    ]);

    expect(await repository.claim(claim('dependent', 'blocked'))).toBeNull();
    expect(await repository.getById(OWNER, 'dependent')).toMatchObject({
      status: 'BLOCKED_DEPENDENCY',
    });
    await repository.claim(claim('replacement', 'replacement-lease'));
    await repository.reconcileSuccess({
      ownerId: OWNER,
      localId: 'replacement',
      leaseToken: 'replacement-lease',
      now: NOW,
      result: receipt('replacement'),
    });
    expect(await repository.claim(claim('dependent', 'ready'))).toMatchObject({
      status: 'SYNCING',
    });
  });

  it('resolve dependência através de múltiplas correções sucessivas', async () => {
    await seed(database, [
      entry('original', {
        aggregateId: 'ORIGINAL',
        status: 'ERROR',
        deliveryDisposition: 'SUPERSEDED',
        supersededByLocalId: 'replacement-1',
      }),
      entry('replacement-1', {
        aggregateId: 'ORIGINAL',
        status: 'ERROR',
        deliveryDisposition: 'SUPERSEDED',
        supersedesLocalId: 'original',
        supersededByLocalId: 'replacement-2',
      }),
      entry('replacement-2', {
        aggregateId: 'ORIGINAL',
        supersedesLocalId: 'replacement-1',
      }),
      entry('dependent', {
        aggregateId: 'DEPENDENT',
        dependencyIds: ['original'],
      }),
    ]);

    expect(await repository.claim(claim('dependent', 'blocked'))).toBeNull();
    await repository.claim(claim('replacement-2', 'replacement-lease'));
    await repository.reconcileSuccess({
      ownerId: OWNER,
      localId: 'replacement-2',
      leaseToken: 'replacement-lease',
      now: NOW,
      result: receipt('replacement-2'),
    });
    expect(await repository.claim(claim('dependent', 'ready'))).toMatchObject({
      status: 'SYNCING',
    });
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
    expect(activity.publish).toHaveBeenCalledOnce();
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
      entry('supervisor-auth', {
        status: 'BLOCKED_AUTH',
        authBlockReason: 'SUPERVISOR',
      }),
    ]);
    const errorIdentity = identity((await repository.getById(OWNER, 'error'))!);

    expect(await repository.retryError(OTHER_OWNER, 'error', NOW)).toBe(false);
    expect(await repository.retryError(OWNER, 'error', NOW)).toBe(true);
    expect(await repository.resumeBlockedAuth(OTHER_OWNER, NOW)).toBe(0);
    expect(await repository.resumeBlockedAuth(OWNER, NOW)).toBe(1);

    expect(await repository.getById(OWNER, 'error')).toMatchObject({ status: 'PENDING' });
    expect(await repository.getById(OWNER, 'error')).toMatchObject({
      manualRetryCount: 1,
      lastManualRetryAt: NOW,
      lastManualRetryBy: OWNER,
    });
    expect(identity((await repository.getById(OWNER, 'error'))!)).toEqual(errorIdentity);
    expect(await repository.getById(OWNER, 'auth')).toMatchObject({ status: 'PENDING' });
    expect(await repository.getById(OWNER, 'auth')).not.toHaveProperty('authBlockReason');
    expect(await repository.getById(OWNER, 'supervisor-auth')).toMatchObject({
      status: 'BLOCKED_AUTH',
      authBlockReason: 'SUPERVISOR',
    });
    supervisorProofs.attach(
      OWNER,
      'supervisor-auth',
      { authorizationId: 'auth-1' },
      new Date('2099-01-01T00:00:00.000Z'),
    );
    expect(
      await repository.resumeSupervisorBlocked(OWNER, 'supervisor-auth', NOW),
    ).toBe(true);
    expect(await repository.getById(OWNER, 'supervisor-auth')).toMatchObject({
      status: 'PENDING',
    });
    expect(await repository.getById(OWNER, 'supervisor-auth'))
      .not.toHaveProperty('authBlockReason');
  });

  it('libera claim com fencing quando a sessão muda antes do envio', async () => {
    await seed(database, [entry('command')]);
    await repository.claim(claim('command', 'lease-a'));

    expect(await repository.releaseClaim(OWNER, 'command', 'stale', NOW)).toBe(false);
    expect(await repository.releaseClaim(OWNER, 'command', 'lease-a', NOW)).toBe(true);
    expect(await repository.getById(OWNER, 'command')).toMatchObject({
      status: 'PENDING',
      attemptCount: 1,
    });
    expect(await repository.getById(OWNER, 'command')).not.toHaveProperty('leaseToken');
  });

  it('marca ciclos e dependência futura no mesmo agregado como bloqueios permanentes', async () => {
    await seed(database, [
      entry('same-head', {
        aggregateId: 'SAME',
        dependencyIds: ['same-later'],
        createdAt: '2026-07-29T12:00:00.000Z',
      }),
      entry('same-later', {
        aggregateId: 'SAME',
        createdAt: '2026-07-29T12:01:00.000Z',
      }),
      entry('cycle-a', {
        aggregateId: 'A',
        dependencyIds: ['cycle-b'],
      }),
      entry('cycle-b', {
        aggregateId: 'B',
        dependencyIds: ['cycle-a'],
      }),
    ]);

    expect(await repository.claim(claim('same-head', 'lease-same'))).toBeNull();
    expect(await repository.claim(claim('cycle-a', 'lease-a'))).toBeNull();
    expect(await repository.claim(claim('cycle-b', 'lease-b'))).toBeNull();

    for (const localId of ['same-head', 'cycle-a', 'cycle-b']) {
      expect(await repository.getById(OWNER, localId)).toMatchObject({
        status: 'BLOCKED_DEPENDENCY',
        lastError: {
          code: 'DEPENDENCY_MISSING',
          category: 'CONFIGURATION',
        },
      });
    }
    expect(
      (await repository.listCandidates(OWNER, NOW, 10)).map((candidate) => candidate.localId),
    ).not.toEqual(expect.arrayContaining(['same-head', 'cycle-a', 'cycle-b']));
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
