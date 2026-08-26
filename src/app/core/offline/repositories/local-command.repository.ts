import { Inject, Injectable, InjectionToken } from '@angular/core';

import { OfflineDatabase } from '../database/offline-database';
import {
  DATABASE_VERSION,
  LOCAL_RECORDS_STORE,
  OUTBOX_STORE,
} from '../database/database-schema';
import {
  JsonValue,
  LocalRecord,
  PersistConfirmedCommandRequest,
  PersistSupersedingCommandRequest,
  normalizeDependencyIds,
} from '../models/local-record';
import { deliveryDispositionOf } from '../models/delivery-disposition';
import {
  AbandonCommandRequest,
  AbandonCommandResult,
  SYNC_UNSYNCHRONIZED_ABANDON,
} from '../models/command-abandonment';
import { OfflineStorageError, toOfflineStorageError } from '../models/offline-storage-error';
import { OutboxEntry, PersistedCommand } from '../models/outbox-entry';
import { IdempotencyService } from '../services/idempotency.service';
import { OutboxActivityService } from '../services/outbox-activity.service';
import { PayloadIntegrityService } from '../services/payload-integrity.service';
import { defensiveCopy, requestResult, transactionComplete } from './repository-utils';

export type NowProvider = () => Date;

export const OFFLINE_NOW_PROVIDER = new InjectionToken<NowProvider>('OFFLINE_NOW_PROVIDER', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

interface ExistingCommand {
  readonly localRecord?: LocalRecord<JsonValue>;
  readonly outboxEntry?: OutboxEntry<JsonValue>;
}

interface CommandFingerprint {
  readonly ownerId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly payloadSchemaVersion: number;
  readonly canonicalPayload: string;
  readonly payloadHash: string;
  readonly businessStatus?: string;
  readonly dependencyIds: readonly string[];
  readonly occurredAt: string;
  readonly initialSyncStatus: 'PENDING' | 'BLOCKED_AUTH';
  readonly initialAuthBlockReason?: 'SESSION' | 'SUPERVISOR';
  readonly deliveryDisposition: 'ACTIVE';
  readonly logicalOccurredAt: string;
}

@Injectable({ providedIn: 'root' })
export class LocalCommandRepository {
  constructor(
    private readonly database: OfflineDatabase,
    private readonly idempotency: IdempotencyService,
    private readonly integrity: PayloadIntegrityService,
    @Inject(OFFLINE_NOW_PROVIDER) private readonly now: NowProvider,
    private readonly activity: OutboxActivityService = new OutboxActivityService(null),
  ) {}

  async persistConfirmedCommand<TPayload>(
    request: PersistConfirmedCommandRequest<TPayload>,
  ): Promise<PersistedCommand<JsonValue>> {
    const metadata = validateRequest(request);
    const initialState = validateInitialState(request);
    const idempotencyKey = this.idempotency.resolve(request.idempotencyKey);
    const dependencyIds = Object.freeze(
      normalizeDependencyIds(request.dependencyIds).map((dependencyId) =>
        dependencyId.toLowerCase(),
      ),
    );
    if (dependencyIds.includes(idempotencyKey)) {
      throw new OfflineStorageError(
        'PAYLOAD_INVALID',
        'Um comando não pode depender da própria identidade.',
      );
    }
    const requestedOccurredAt =
      request.occurredAt !== undefined ? validIsoDate(request.occurredAt) : undefined;
    const payload = request.payload;
    const prepared = await this.integrity.prepare(payload);
    const committedAt = validDate(this.now(), 'O relógio local retornou uma data inválida.');
    const existing = await this.findExisting(idempotencyKey);
    const occurredAt =
      requestedOccurredAt ??
      existing.localRecord?.occurredAt ??
      existing.outboxEntry?.occurredAt ??
      committedAt;
    const fingerprint: CommandFingerprint = {
      ...metadata,
      canonicalPayload: prepared.canonicalPayload,
      payloadHash: prepared.payloadHash,
      dependencyIds,
      occurredAt,
      initialSyncStatus: initialState.status,
      deliveryDisposition: 'ACTIVE',
      logicalOccurredAt: occurredAt,
      ...(initialState.reason
        ? { initialAuthBlockReason: initialState.reason }
        : {}),
    };

    if (existing.localRecord || existing.outboxEntry) {
      return resolveExisting(existing, fingerprint);
    }

    const localRecord: LocalRecord<JsonValue> = Object.freeze({
      localId: idempotencyKey,
      idempotencyKey,
      databaseVersion: DATABASE_VERSION,
      payloadSchemaVersion: metadata.payloadSchemaVersion,
      aggregateType: metadata.aggregateType,
      aggregateId: metadata.aggregateId,
      commandType: metadata.commandType,
      payload: prepared.snapshot,
      canonicalPayload: prepared.canonicalPayload,
      payloadHash: prepared.payloadHash,
      ownerId: metadata.ownerId,
      initialSyncStatus: fingerprint.initialSyncStatus,
      ...(fingerprint.initialAuthBlockReason
        ? { initialAuthBlockReason: fingerprint.initialAuthBlockReason }
        : {}),
      ...(metadata.businessStatus ? { businessStatus: metadata.businessStatus } : {}),
      dependencyIds,
      occurredAt,
      createdAt: committedAt,
      updatedAt: committedAt,
      deliveryDisposition: 'ACTIVE',
      logicalOccurredAt: occurredAt,
    });
    const outboxEntry: OutboxEntry<JsonValue> = Object.freeze({
      localId: idempotencyKey,
      idempotencyKey,
      payloadSchemaVersion: metadata.payloadSchemaVersion,
      aggregateType: metadata.aggregateType,
      aggregateId: metadata.aggregateId,
      commandType: metadata.commandType,
      payload: prepared.snapshot,
      canonicalPayload: prepared.canonicalPayload,
      payloadHash: prepared.payloadHash,
      ownerId: metadata.ownerId,
      status: fingerprint.initialSyncStatus,
      ...(fingerprint.initialAuthBlockReason
        ? { authBlockReason: fingerprint.initialAuthBlockReason }
        : {}),
      ...(metadata.businessStatus ? { businessStatus: metadata.businessStatus } : {}),
      dependencyIds,
      attemptCount: 0,
      occurredAt,
      createdAt: committedAt,
      updatedAt: committedAt,
      deliveryDisposition: 'ACTIVE',
      logicalOccurredAt: occurredAt,
    });

    const transaction = await this.database.createTransaction(
      [LOCAL_RECORDS_STORE, OUTBOX_STORE],
      'readwrite',
    );
    const completed = transactionComplete(transaction);
    transaction.objectStore(LOCAL_RECORDS_STORE).add(localRecord);
    transaction.objectStore(OUTBOX_STORE).add(outboxEntry);

    try {
      await completed;
    } catch (error) {
      const diagnosed = await this.findExisting(idempotencyKey);
      if (diagnosed.localRecord || diagnosed.outboxEntry) {
        return resolveExisting(diagnosed, fingerprint);
      }
      throw toOfflineStorageError(error, 'O comando não foi salvo neste dispositivo.');
    }
    this.activity.publish();

    return defensiveCopy({
      localId: idempotencyKey,
      idempotencyKey,
      payloadHash: prepared.payloadHash,
      localRecord,
      outboxEntry,
      committedAt,
    });
  }

  async persistSupersedingCommand<TPayload>(
    request: PersistSupersedingCommandRequest<TPayload>,
  ): Promise<PersistedCommand<JsonValue>> {
    const ownerId = requiredText(request.ownerId);
    const actorId = requiredText(request.actorId);
    const originalLocalId = requiredText(request.originalLocalId);
    if (actorId !== ownerId) {
      throw new OfflineStorageError(
        'PAYLOAD_INVALID',
        'A correção deve ser confirmada pelo owner atual.',
      );
    }
    const metadata = validateRequest(request.command);
    if (metadata.ownerId !== ownerId) {
      throw new OfflineStorageError(
        'PAYLOAD_INVALID',
        'O novo comando deve pertencer ao mesmo owner.',
      );
    }
    const initialState = validateInitialState(request.command);
    const prepared = await this.integrity.prepare(request.command.payload);
    const committedAt = validDate(this.now(), 'O relógio local retornou uma data inválida.');
    const occurredAt = request.command.occurredAt !== undefined
      ? validIsoDate(request.command.occurredAt)
      : committedAt;
    const localId = this.idempotency.resolve();
    if (localId === originalLocalId) {
      throw new OfflineStorageError('CONFLICT', 'A correção deve usar uma nova identidade.');
    }

    const transaction = await this.database.createTransaction(
      [LOCAL_RECORDS_STORE, OUTBOX_STORE],
      'readwrite',
    );
    const completed = transactionComplete(transaction);
    const localStore = transaction.objectStore(LOCAL_RECORDS_STORE);
    const outboxStore = transaction.objectStore(OUTBOX_STORE);
    const [originalLocal, originalOutbox] = await Promise.all([
      requestResult<LocalRecord<JsonValue> | undefined>(
        localStore.get(originalLocalId),
        'Não foi possível revalidar o registro original.',
      ),
      requestResult<OutboxEntry<JsonValue> | undefined>(
        outboxStore.get(originalLocalId),
        'Não foi possível revalidar a Outbox original.',
      ),
    ]);
    if (
      request.sessionIsCurrent?.() === false
      ||
      !originalLocal
      || !originalOutbox
      || originalLocal.ownerId !== ownerId
      || originalOutbox.ownerId !== ownerId
      || originalOutbox.status !== 'ERROR'
      || deliveryDispositionOf(originalLocal.deliveryDisposition) !== 'ACTIVE'
      || deliveryDispositionOf(originalOutbox.deliveryDisposition) !== 'ACTIVE'
      || originalOutbox.leaseToken
      || metadata.aggregateType !== originalOutbox.aggregateType
      || metadata.aggregateId !== originalOutbox.aggregateId
      || metadata.commandType !== originalOutbox.commandType
      || metadata.payloadSchemaVersion !== originalOutbox.payloadSchemaVersion
    ) {
      transaction.abort();
      await completed.catch(() => undefined);
      throw new OfflineStorageError(
        'CONFLICT',
        'O registro mudou ou não aceita mais correção.',
      );
    }
    const dependencyIds = Object.freeze([...originalOutbox.dependencyIds]);
    const logicalOccurredAt =
      originalOutbox.logicalOccurredAt ?? originalOutbox.occurredAt;
    const localRecord: LocalRecord<JsonValue> = Object.freeze({
      localId,
      idempotencyKey: localId,
      databaseVersion: DATABASE_VERSION,
      payloadSchemaVersion: metadata.payloadSchemaVersion,
      aggregateType: metadata.aggregateType,
      aggregateId: metadata.aggregateId,
      commandType: metadata.commandType,
      payload: prepared.snapshot,
      canonicalPayload: prepared.canonicalPayload,
      payloadHash: prepared.payloadHash,
      ownerId,
      initialSyncStatus: initialState.status,
      ...(initialState.reason ? { initialAuthBlockReason: initialState.reason } : {}),
      ...(metadata.businessStatus ? { businessStatus: metadata.businessStatus } : {}),
      dependencyIds,
      occurredAt,
      createdAt: committedAt,
      updatedAt: committedAt,
      deliveryDisposition: 'ACTIVE',
      logicalOccurredAt,
      supersedesLocalId: originalLocalId,
    });
    const outboxEntry: OutboxEntry<JsonValue> = Object.freeze({
      localId,
      idempotencyKey: localId,
      payloadSchemaVersion: metadata.payloadSchemaVersion,
      aggregateType: metadata.aggregateType,
      aggregateId: metadata.aggregateId,
      commandType: metadata.commandType,
      payload: prepared.snapshot,
      canonicalPayload: prepared.canonicalPayload,
      payloadHash: prepared.payloadHash,
      ownerId,
      status: initialState.status,
      ...(initialState.reason ? { authBlockReason: initialState.reason } : {}),
      ...(metadata.businessStatus ? { businessStatus: metadata.businessStatus } : {}),
      dependencyIds,
      attemptCount: 0,
      occurredAt,
      createdAt: committedAt,
      updatedAt: committedAt,
      deliveryDisposition: 'ACTIVE',
      logicalOccurredAt,
      supersedesLocalId: originalLocalId,
    });
    const supersession = {
      deliveryDisposition: 'SUPERSEDED' as const,
      supersededByLocalId: localId,
      supersededAt: committedAt,
      supersededBy: actorId,
      updatedAt: committedAt,
    };
    localStore.add(localRecord);
    outboxStore.add(outboxEntry);
    localStore.put({ ...originalLocal, ...supersession });
    outboxStore.put({ ...originalOutbox, ...supersession });
    let sessionInvalidated = false;
    const stopWatchingSession = request.watchSession?.(() => {
      if (request.sessionIsCurrent?.() === false) {
        sessionInvalidated = true;
        try {
          transaction.abort();
        } catch {
          // A transação já pode ter encerrado.
        }
      }
    });
    try {
      await completed;
    } catch (error) {
      if (sessionInvalidated) {
        throw new OfflineStorageError(
          'CONFLICT',
          'A sessão mudou antes da confirmação da correção.',
        );
      }
      throw toOfflineStorageError(error, 'A correção não foi salva neste dispositivo.');
    } finally {
      stopWatchingSession?.();
    }
    this.activity.publish();
    return defensiveCopy({
      localId,
      idempotencyKey: localId,
      payloadHash: prepared.payloadHash,
      localRecord,
      outboxEntry,
      committedAt,
    });
  }

  async abandonCommand(request: AbandonCommandRequest): Promise<AbandonCommandResult> {
    const ownerId = requiredText(request.ownerId);
    const actorId = requiredText(request.actorId);
    const localId = requiredText(request.localId);
    const now = validIsoDate(request.now);
    const reason = normalizeCoreAbandonReason(request.reason);
    if (
      !request.authorized
      || request.permission !== SYNC_UNSYNCHRONIZED_ABANDON
      || actorId !== ownerId
      || reason === null
    ) {
      return 'denied';
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = await this.database.createTransaction(
        [LOCAL_RECORDS_STORE, OUTBOX_STORE],
        'readwrite',
      );
      const completed = transactionComplete(transaction);
      const localStore = transaction.objectStore(LOCAL_RECORDS_STORE);
      const outboxStore = transaction.objectStore(OUTBOX_STORE);
      const [localRecord, outboxEntry, ownerEntries] = await Promise.all([
        requestResult<LocalRecord<JsonValue> | undefined>(
          localStore.get(localId),
          'Não foi possível revalidar o registro local.',
        ),
        requestResult<OutboxEntry<JsonValue> | undefined>(
          outboxStore.get(localId),
          'Não foi possível revalidar a Outbox.',
        ),
        requestResult<OutboxEntry<JsonValue>[]>(
          outboxStore.index('ownerId').getAll(ownerId),
          'Não foi possível revalidar as dependências do owner.',
        ),
      ]);
      if (
        !request.sessionIsCurrent()
        || !localRecord
        || !outboxEntry
        || localRecord.ownerId !== ownerId
        || outboxEntry.ownerId !== ownerId
        || deliveryDispositionOf(localRecord.deliveryDisposition) !== 'ACTIVE'
        || deliveryDispositionOf(outboxEntry.deliveryDisposition) !== 'ACTIVE'
        || outboxEntry.status === 'SYNCED'
        || outboxEntry.status === 'SYNCING'
        || Boolean(outboxEntry.leaseToken)
      ) {
        transaction.abort();
        await completed.catch(() => undefined);
        return 'stale-or-ineligible';
      }
      const hasDependents = ownerEntries.some(candidate =>
        candidate.localId !== localId
        && deliveryDispositionOf(candidate.deliveryDisposition) === 'ACTIVE'
        && candidate.status !== 'SYNCED'
        && candidate.dependencyIds.some(dependencyId =>
          dependencyResolvesTo(dependencyId, localId, ownerEntries, ownerId)));
      if (hasDependents) {
        transaction.abort();
        await completed.catch(() => undefined);
        return 'has-dependents';
      }
      const targetLogical =
        outboxEntry.logicalOccurredAt ?? outboxEntry.occurredAt ?? outboxEntry.createdAt;
      const hasLaterCommands = ownerEntries.some(candidate =>
        candidate.localId !== localId
        && candidate.aggregateType === outboxEntry.aggregateType
        && candidate.aggregateId === outboxEntry.aggregateId
        && deliveryDispositionOf(candidate.deliveryDisposition) === 'ACTIVE'
        && candidate.status !== 'SYNCED'
        && !outboxEntry.dependencyIds.some(dependencyId =>
          dependencyResolvesTo(dependencyId, candidate.localId, ownerEntries, ownerId))
        && compareLogicalPosition(
          candidate.logicalOccurredAt ?? candidate.occurredAt ?? candidate.createdAt,
          candidate.localId,
          targetLogical,
          outboxEntry.localId,
        ) > 0);
      if (hasLaterCommands) {
        transaction.abort();
        await completed.catch(() => undefined);
        return 'has-later-commands';
      }
      if (!request.sessionIsCurrent()) {
        transaction.abort();
        await completed.catch(() => undefined);
        return 'stale-or-ineligible';
      }
      const abandonment = {
        deliveryDisposition: 'ABANDONED' as const,
        abandonedAt: now,
        abandonedBy: actorId,
        abandonReason: reason,
        abandonPermission: SYNC_UNSYNCHRONIZED_ABANDON,
        updatedAt: now,
      };
      localStore.put({ ...localRecord, ...abandonment });
      outboxStore.put({ ...outboxEntry, ...abandonment });
      let sessionInvalidated = false;
      const stopWatchingSession = request.watchSession?.(() => {
        if (!request.sessionIsCurrent()) {
          sessionInvalidated = true;
          try {
            transaction?.abort();
          } catch {
            // A transação já pode ter encerrado.
          }
        }
      });
      try {
        await completed;
      } catch (error) {
        if (sessionInvalidated) return 'stale-or-ineligible';
        throw error;
      } finally {
        stopWatchingSession?.();
      }
      this.activity.publish();
      return 'abandoned';
    } catch {
      try {
        transaction?.abort();
      } catch {
        // A transação já pode ter encerrado.
      }
      return 'storage-error';
    }
  }

  private async findExisting(idempotencyKey: string): Promise<ExistingCommand> {
    const transaction = await this.database.createTransaction(
      [LOCAL_RECORDS_STORE, OUTBOX_STORE],
      'readonly',
    );
    const localRequest = transaction
      .objectStore(LOCAL_RECORDS_STORE)
      .index('idempotencyKey')
      .get(idempotencyKey);
    const outboxRequest = transaction
      .objectStore(OUTBOX_STORE)
      .index('idempotencyKey')
      .get(idempotencyKey);
    const [localRecord, outboxEntry] = await Promise.all([
      requestResult<LocalRecord<JsonValue> | undefined>(
        localRequest,
        'Não foi possível diagnosticar a identidade local.',
      ),
      requestResult<OutboxEntry<JsonValue> | undefined>(
        outboxRequest,
        'Não foi possível diagnosticar a identidade da Outbox.',
      ),
    ]);
    return { localRecord, outboxEntry };
  }
}

function dependencyResolvesTo(
  dependencyId: string,
  targetLocalId: string,
  entries: readonly OutboxEntry<JsonValue>[],
  ownerId: string,
): boolean {
  const byId = new Map(
    entries
      .filter(entry => entry.ownerId === ownerId)
      .map(entry => [entry.localId, entry] as const),
  );
  const visited = new Set<string>();
  let current = byId.get(dependencyId);
  while (current && !visited.has(current.localId)) {
    if (current.localId === targetLocalId) return true;
    visited.add(current.localId);
    if (deliveryDispositionOf(current.deliveryDisposition) !== 'SUPERSEDED') return false;
    current = current.supersededByLocalId
      ? byId.get(current.supersededByLocalId)
      : entries.find(entry =>
          entry.ownerId === ownerId && entry.supersedesLocalId === current?.localId);
  }
  return false;
}

function compareLogicalPosition(
  leftAt: string,
  leftId: string,
  rightAt: string,
  rightId: string,
): number {
  return leftAt.localeCompare(rightAt) || leftId.localeCompare(rightId);
}

function validateRequest<TPayload>(request: PersistConfirmedCommandRequest<TPayload>): {
  readonly ownerId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly commandType: string;
  readonly payloadSchemaVersion: number;
  readonly businessStatus?: string;
} {
  const ownerId = requiredText(request.ownerId);
  const aggregateType = requiredText(request.aggregateType);
  const aggregateId = requiredText(request.aggregateId);
  const commandType = requiredText(request.commandType);
  const payloadSchemaVersion = request.payloadSchemaVersion;
  if (!Number.isInteger(payloadSchemaVersion) || payloadSchemaVersion < 1) {
    throw new OfflineStorageError(
      'PAYLOAD_INVALID',
      'A versão do schema do payload deve ser um inteiro positivo.',
    );
  }
  const businessStatus = request.businessStatus?.trim();
  return {
    ownerId,
    aggregateType,
    aggregateId,
    commandType,
    payloadSchemaVersion,
    ...(businessStatus ? { businessStatus } : {}),
  };
}

function validateInitialState<TPayload>(
  request: PersistConfirmedCommandRequest<TPayload>,
): {
  readonly status: 'PENDING' | 'BLOCKED_AUTH';
  readonly reason?: 'SESSION' | 'SUPERVISOR';
} {
  const status = request.initialSyncStatus ?? 'PENDING';
  const reason = request.initialAuthBlockReason;
  if (
    (status === 'PENDING' && reason !== undefined)
    || (status === 'BLOCKED_AUTH' && reason === undefined)
  ) {
    throw new OfflineStorageError(
      'PAYLOAD_INVALID',
      'O estado inicial e o motivo de bloqueio de autenticação são incompatíveis.',
    );
  }
  return {
    status,
    ...(reason ? { reason } : {}),
  };
}

function requiredText(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new OfflineStorageError(
      'PAYLOAD_INVALID',
      'Os identificadores obrigatórios do comando devem ser informados.',
    );
  }
  return normalized;
}

function validIsoDate(value: string): string {
  const date = new Date(value);
  return validDate(date, 'A data informada para o comando é inválida.');
}

function validDate(value: Date, message: string): string {
  if (Number.isNaN(value.getTime())) {
    throw new OfflineStorageError('PAYLOAD_INVALID', message);
  }
  return value.toISOString();
}

function normalizeCoreAbandonReason(value: string): string | null {
  const normalized = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    normalized.length < 10
    || normalized.length > 500
    || /\b(?:senha|password|passphrase|token|bearer|api[_ -]?key|secret|credencial)\b\s*[:=]?\s*\S+/iu
      .test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function resolveExisting(
  existing: ExistingCommand,
  fingerprint: CommandFingerprint,
): PersistedCommand<JsonValue> {
  if (
    !existing.localRecord ||
    !existing.outboxEntry ||
    !matchesFingerprint(existing.localRecord, fingerprint) ||
    !matchesFingerprint(existing.outboxEntry, fingerprint)
  ) {
    throw new OfflineStorageError(
      'CONFLICT',
      'A chave de idempotência já identifica outro comando local.',
    );
  }

  return defensiveCopy({
    localId: existing.localRecord.localId,
    idempotencyKey: existing.localRecord.idempotencyKey,
    payloadHash: existing.localRecord.payloadHash,
    localRecord: existing.localRecord,
    outboxEntry: existing.outboxEntry,
    committedAt: existing.localRecord.createdAt,
  });
}

function matchesFingerprint(
  record: LocalRecord<JsonValue> | OutboxEntry<JsonValue>,
  fingerprint: CommandFingerprint,
): boolean {
  const immutableMatches =
    record.ownerId === fingerprint.ownerId &&
    record.aggregateType === fingerprint.aggregateType &&
    record.aggregateId === fingerprint.aggregateId &&
    record.commandType === fingerprint.commandType &&
    record.payloadSchemaVersion === fingerprint.payloadSchemaVersion &&
    record.canonicalPayload === fingerprint.canonicalPayload &&
    record.payloadHash === fingerprint.payloadHash &&
    record.businessStatus === fingerprint.businessStatus &&
    record.occurredAt === fingerprint.occurredAt &&
    deliveryDispositionOf(record.deliveryDisposition) === fingerprint.deliveryDisposition &&
    (record.logicalOccurredAt ?? record.occurredAt) === fingerprint.logicalOccurredAt &&
    sameStrings(record.dependencyIds, fingerprint.dependencyIds);
  if (!immutableMatches) {
    return false;
  }
  if ('status' in record) {
    return true;
  }
  return (record.initialSyncStatus ?? 'PENDING') === fingerprint.initialSyncStatus
    && record.initialAuthBlockReason === fingerprint.initialAuthBlockReason;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
