import { Injectable } from '@angular/core';

import { OfflineDatabase } from '../database/offline-database';
import { OUTBOX_STORE } from '../database/database-schema';
import { JsonValue } from '../models/local-record';
import {
  OutboxEntry,
  PersistedSyncError,
  RemoteCommandReceipt,
} from '../models/outbox-entry';
import {
  assertOwnerId,
  defensiveCopy,
  requestResult,
  transactionComplete,
} from './repository-utils';
import { SupervisorProofVault } from '../services/supervisor-proof-vault';

export interface ClaimOutboxRequest {
  readonly ownerId: string;
  readonly localId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export interface ReconcileSuccessRequest {
  readonly ownerId: string;
  readonly localId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly result: RemoteCommandReceipt & { readonly idempotencyKey?: string };
}

interface ReconcileFailureBase {
  readonly ownerId: string;
  readonly localId: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly error: PersistedSyncError;
}

export type ReconcileFailureRequest =
  | (ReconcileFailureBase & {
      readonly status: 'RETRY_WAIT';
      readonly nextAttemptAt: string;
    })
  | (ReconcileFailureBase & {
      readonly status: 'BLOCKED_AUTH' | 'BLOCKED_DEPENDENCY' | 'ERROR';
      readonly nextAttemptAt?: never;
    });

@Injectable({ providedIn: 'root' })
export class OutboxRepository {
  constructor(
    private readonly database: OfflineDatabase,
    private readonly supervisorProofs: SupervisorProofVault = new SupervisorProofVault(),
  ) {}

  async getById(ownerId: string, localId: string): Promise<OutboxEntry<JsonValue> | null> {
    const owner = assertOwnerId(ownerId);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readonly');
    const entry = await requestResult<OutboxEntry<JsonValue> | undefined>(
      transaction.objectStore(OUTBOX_STORE).get(localId),
      'Não foi possível consultar a Outbox local.',
    );
    return entry?.ownerId === owner ? defensiveCopy(entry) : null;
  }

  async getByIdempotencyKey(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<OutboxEntry<JsonValue> | null> {
    const owner = assertOwnerId(ownerId);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readonly');
    const entry = await requestResult<OutboxEntry<JsonValue> | undefined>(
      transaction.objectStore(OUTBOX_STORE).index('idempotencyKey').get(idempotencyKey),
      'Não foi possível consultar a identidade da Outbox.',
    );
    return entry?.ownerId === owner ? defensiveCopy(entry) : null;
  }

  async listByOwner(ownerId: string): Promise<readonly OutboxEntry<JsonValue>[]> {
    const owner = assertOwnerId(ownerId);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readonly');
    const entries = await requestResult<OutboxEntry<JsonValue>[]>(
      transaction.objectStore(OUTBOX_STORE).index('ownerId').getAll(owner),
      'Não foi possível listar a Outbox local.',
    );
    return defensiveCopy(entries);
  }

  async listCandidates(
    ownerId: string,
    now: string,
    limit: number,
  ): Promise<readonly OutboxEntry<JsonValue>[]> {
    const owner = assertOwnerId(ownerId);
    const normalizedNow = validIso(now);
    if (!Number.isInteger(limit) || limit < 1) {
      return [];
    }

    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readonly');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const [orderedEntries, dueEntries] = await Promise.all([
      requestResult<OutboxEntry<JsonValue>[]>(
        store.index('ownerAggregateOrder').getAll(ownerRange(owner)),
        'Não foi possível ordenar a Outbox por agregado.',
      ),
      requestResult<OutboxEntry<JsonValue>[]>(
        store
          .index('ownerStatusDue')
          .getAll(dueRange(owner, normalizedNow)),
        'Não foi possível consultar os agendamentos da Outbox.',
      ),
    ]);
    await completed;

    const dueIds = new Set(
      dueEntries
        .filter(
          (entry) =>
            entry.ownerId === owner &&
            entry.status === 'RETRY_WAIT' &&
            Boolean(entry.nextAttemptAt) &&
            entry.nextAttemptAt! <= normalizedNow,
        )
        .map((entry) => entry.localId),
    );
    const heads = new Map<string, OutboxEntry<JsonValue>>();
    for (const entry of orderedEntries) {
      if (entry.ownerId !== owner || entry.status === 'SYNCED') {
        continue;
      }
      const aggregateKey = `${entry.aggregateType}\u0000${entry.aggregateId}`;
      if (!heads.has(aggregateKey)) {
        heads.set(aggregateKey, entry);
      }
    }

    return defensiveCopy(
      [...heads.values()]
        .filter((entry) => isEligible(entry, normalizedNow, dueIds))
        .sort(compareEntries)
        .slice(0, limit),
    );
  }

  async claim(request: ClaimOutboxRequest): Promise<OutboxEntry<JsonValue> | null> {
    const owner = assertOwnerId(request.ownerId);
    const now = validIso(request.now);
    const leaseExpiresAt = validIso(request.leaseExpiresAt);
    const leaseToken = requiredText(request.leaseToken);
    if (leaseExpiresAt <= now) {
      return null;
    }

    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const allEntries = await requestResult<OutboxEntry<JsonValue>[]>(
      store.index('ownerAggregateOrder').getAll(ownerRange(owner)),
      'Não foi possível revalidar a Outbox antes do claim.',
    );
    const current = allEntries.find(
      (entry) => entry.localId === request.localId && entry.ownerId === owner,
    );
    if (!current || !isClaimableState(current, now)) {
      await completed;
      return null;
    }

    const aggregateEntries = allEntries.filter(
      (entry) =>
        entry.ownerId === owner &&
        entry.aggregateType === current.aggregateType &&
        entry.aggregateId === current.aggregateId &&
        entry.status !== 'SYNCED',
    );
    const head = aggregateEntries.sort(compareEntries)[0];
    if (!head || head.localId !== current.localId) {
      if (head) {
        store.put(blocked(current, now));
      }
      await completed;
      return null;
    }

    const dependencyState = inspectDependencies(current, allEntries, owner);
    if (dependencyState !== 'READY') {
      store.put(
        blocked(
          current,
          now,
          dependencyState === 'MISSING_OR_PERMANENT'
            ? {
                code: 'DEPENDENCY_MISSING',
                category: 'CONFIGURATION',
                userMessage: 'Uma dependência exige intervenção antes da sincronização.',
              }
            : undefined,
        ),
      );
      await completed;
      return null;
    }

    const claimed: OutboxEntry<JsonValue> = {
      ...withoutRuntimeState(current),
      status: 'SYNCING',
      attemptCount: current.attemptCount + 1,
      lastAttemptAt: now,
      leaseToken,
      leaseExpiresAt,
      updatedAt: now,
    };
    store.put(claimed);
    await completed;
    return defensiveCopy(claimed);
  }

  async reconcileSuccess(request: ReconcileSuccessRequest): Promise<boolean> {
    const owner = assertOwnerId(request.ownerId);
    const now = validIso(request.now);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const current = await requestResult<OutboxEntry<JsonValue> | undefined>(
      store.get(request.localId),
      'Não foi possível reconciliar o resultado remoto.',
    );
    if (
      !ownsLease(current, owner, request.leaseToken) ||
      (request.result.idempotencyKey !== undefined &&
        request.result.idempotencyKey !== current.idempotencyKey)
    ) {
      await completed;
      return false;
    }

    const { idempotencyKey: _returnedKey, ...receipt } = request.result;
    const synchronized: OutboxEntry<JsonValue> = {
      ...withoutRuntimeState(current),
      status: 'SYNCED',
      synchronizedAt: now,
      receipt,
      updatedAt: now,
    };
    store.put(synchronized);
    await completed;
    this.supervisorProofs.clear(owner, request.localId);
    return true;
  }

  async reconcileFailure(request: ReconcileFailureRequest): Promise<boolean> {
    const owner = assertOwnerId(request.ownerId);
    const now = validIso(request.now);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const current = await requestResult<OutboxEntry<JsonValue> | undefined>(
      store.get(request.localId),
      'Não foi possível reconciliar a falha remota.',
    );
    if (!ownsLease(current, owner, request.leaseToken)) {
      await completed;
      return false;
    }

    const failed: OutboxEntry<JsonValue> = {
      ...withoutRuntimeState(current),
      status: request.status,
      ...(request.status === 'RETRY_WAIT'
        ? { nextAttemptAt: validIso(request.nextAttemptAt) }
        : {}),
      lastError: defensiveCopy(request.error),
      updatedAt: now,
    };
    store.put(failed);
    await completed;
    return true;
  }

  async retryError(ownerId: string, localId: string, now: string): Promise<boolean> {
    const owner = assertOwnerId(ownerId);
    const normalizedNow = validIso(now);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const current = await requestResult<OutboxEntry<JsonValue> | undefined>(
      store.get(localId),
      'Não foi possível reabilitar o comando.',
    );
    if (!current || current.ownerId !== owner || current.status !== 'ERROR') {
      await completed;
      return false;
    }
    store.put({
      ...withoutRuntimeState(current),
      status: 'PENDING',
      manualRetryCount: (current.manualRetryCount ?? 0) + 1,
      lastManualRetryAt: normalizedNow,
      lastManualRetryBy: owner,
      updatedAt: normalizedNow,
    } satisfies OutboxEntry<JsonValue>);
    await completed;
    return true;
  }

  async releaseClaim(
    ownerId: string,
    localId: string,
    leaseToken: string,
    now: string,
  ): Promise<boolean> {
    const owner = assertOwnerId(ownerId);
    const normalizedNow = validIso(now);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const current = await requestResult<OutboxEntry<JsonValue> | undefined>(
      store.get(localId),
      'Não foi possível liberar o claim após a mudança de sessão.',
    );
    if (!ownsLease(current, owner, leaseToken)) {
      await completed;
      return false;
    }
    store.put({
      ...withoutRuntimeState(current),
      status: 'PENDING',
      updatedAt: normalizedNow,
    } satisfies OutboxEntry<JsonValue>);
    await completed;
    return true;
  }

  async resumeBlockedAuth(ownerId: string, now: string): Promise<number> {
    const owner = assertOwnerId(ownerId);
    const normalizedNow = validIso(now);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const entries = await requestResult<OutboxEntry<JsonValue>[]>(
      store.index('ownerStatus').getAll([owner, 'BLOCKED_AUTH']),
      'Não foi possível reabilitar os comandos após autenticação.',
    );
    for (const entry of entries) {
      if (entry.authBlockReason === 'SUPERVISOR') {
        continue;
      }
      const { authBlockReason: _reason, ...withoutReason } = withoutRuntimeState(entry);
      store.put({
        ...withoutReason,
        status: 'PENDING',
        updatedAt: normalizedNow,
      } satisfies OutboxEntry<JsonValue>);
    }
    await completed;
    return entries.filter(entry => entry.authBlockReason !== 'SUPERVISOR').length;
  }

  async resumeSupervisorBlocked(
    ownerId: string,
    localId: string,
    now: string,
  ): Promise<boolean> {
    const owner = assertOwnerId(ownerId);
    const normalizedNow = validIso(now);
    const transaction = await this.database.createTransaction([OUTBOX_STORE], 'readwrite');
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(OUTBOX_STORE);
    const current = await requestResult<OutboxEntry<JsonValue> | undefined>(
      store.get(localId),
      'Não foi possível retomar a autorização do supervisor.',
    );
    if (
      !current
      || current.ownerId !== owner
      || current.status !== 'BLOCKED_AUTH'
      || current.authBlockReason !== 'SUPERVISOR'
      || this.supervisorProofs.read(owner, localId) === null
    ) {
      await completed;
      return false;
    }
    const { authBlockReason: _reason, ...withoutReason } = current;
    store.put({
      ...withoutReason,
      status: 'PENDING',
      updatedAt: normalizedNow,
    } satisfies OutboxEntry<JsonValue>);
    await completed;
    return true;
  }
}

function isEligible(
  entry: OutboxEntry<JsonValue>,
  now: string,
  dueIds: ReadonlySet<string>,
): boolean {
  return (
    entry.status === 'PENDING' ||
    (entry.status === 'BLOCKED_DEPENDENCY' && !isPermanentDependencyBlock(entry)) ||
    (entry.status === 'RETRY_WAIT' && dueIds.has(entry.localId)) ||
    (entry.status === 'SYNCING' &&
      Boolean(entry.leaseExpiresAt) &&
      entry.leaseExpiresAt! <= now)
  );
}

function isClaimableState(entry: OutboxEntry<JsonValue>, now: string): boolean {
  return (
    entry.status === 'PENDING' ||
    (entry.status === 'BLOCKED_DEPENDENCY' && !isPermanentDependencyBlock(entry)) ||
    (entry.status === 'RETRY_WAIT' &&
      Boolean(entry.nextAttemptAt) &&
      entry.nextAttemptAt! <= now) ||
    (entry.status === 'SYNCING' &&
      Boolean(entry.leaseExpiresAt) &&
      entry.leaseExpiresAt! <= now)
  );
}

function inspectDependencies(
  entry: OutboxEntry<JsonValue>,
  allEntries: readonly OutboxEntry<JsonValue>[],
  owner: string,
): 'READY' | 'PENDING' | 'MISSING_OR_PERMANENT' {
  for (const dependencyId of entry.dependencyIds) {
    const dependency = allEntries.find(
      (candidate) => candidate.localId === dependencyId && candidate.ownerId === owner,
    );
    if (!dependency || dependency.status === 'ERROR') {
      return 'MISSING_OR_PERMANENT';
    }
    if (dependency.status !== 'SYNCED') {
      if (
        (dependency.aggregateType === entry.aggregateType &&
          dependency.aggregateId === entry.aggregateId &&
          compareEntries(dependency, entry) > 0) ||
        hasDependencyPath(dependency.localId, entry.localId, allEntries, owner)
      ) {
        return 'MISSING_OR_PERMANENT';
      }
      return 'PENDING';
    }
  }
  return 'READY';
}

function hasDependencyPath(
  startId: string,
  targetId: string,
  entries: readonly OutboxEntry<JsonValue>[],
  owner: string,
): boolean {
  const byId = new Map(
    entries
      .filter((candidate) => candidate.ownerId === owner && candidate.status !== 'SYNCED')
      .map((candidate) => [candidate.localId, candidate] as const),
  );
  const visited = new Set<string>();
  const pending = [startId];
  while (pending.length > 0) {
    const currentId = pending.pop()!;
    if (currentId === targetId) {
      return true;
    }
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    const current = byId.get(currentId);
    if (current) {
      pending.push(...current.dependencyIds);
    }
  }
  return false;
}

function isPermanentDependencyBlock(entry: OutboxEntry<JsonValue>): boolean {
  return (
    entry.lastError?.code === 'DEPENDENCY_MISSING' &&
    entry.lastError.category === 'CONFIGURATION'
  );
}

function ownerRange(owner: string): IDBKeyRange | undefined {
  return globalThis.IDBKeyRange?.bound([owner], [owner, []]);
}

function dueRange(owner: string, now: string): IDBKeyRange | undefined {
  return globalThis.IDBKeyRange?.bound(
    [owner, 'RETRY_WAIT', ''],
    [owner, 'RETRY_WAIT', now],
  );
}

function blocked(
  entry: OutboxEntry<JsonValue>,
  now: string,
  error?: PersistedSyncError,
): OutboxEntry<JsonValue> {
  return {
    ...withoutRuntimeState(entry),
    status: 'BLOCKED_DEPENDENCY',
    ...(error ? { lastError: error } : {}),
    updatedAt: now,
  };
}

function withoutRuntimeState(entry: OutboxEntry<JsonValue>): OutboxEntry<JsonValue> {
  const {
    leaseToken: _leaseToken,
    leaseExpiresAt: _leaseExpiresAt,
    nextAttemptAt: _nextAttemptAt,
    synchronizedAt: _synchronizedAt,
    receipt: _receipt,
    lastError: _lastError,
    ...stable
  } = entry;
  return stable;
}

function ownsLease(
  entry: OutboxEntry<JsonValue> | undefined,
  owner: string,
  leaseToken: string,
): entry is OutboxEntry<JsonValue> {
  return (
    entry?.ownerId === owner &&
    entry.status === 'SYNCING' &&
    entry.leaseToken === leaseToken
  );
}

function compareEntries(left: OutboxEntry<JsonValue>, right: OutboxEntry<JsonValue>): number {
  return left.createdAt.localeCompare(right.createdAt) || left.localId.localeCompare(right.localId);
}

function validIso(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new TypeError('A data da operação da Outbox é inválida.');
  }
  return new Date(timestamp).toISOString();
}

function requiredText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError('O token de lease é obrigatório.');
  }
  return normalized;
}
