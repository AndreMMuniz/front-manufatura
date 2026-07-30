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
  normalizeDependencyIds,
} from '../models/local-record';
import { OfflineStorageError, toOfflineStorageError } from '../models/offline-storage-error';
import { OutboxEntry, PersistedCommand } from '../models/outbox-entry';
import { IdempotencyService } from '../services/idempotency.service';
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
}

@Injectable({ providedIn: 'root' })
export class LocalCommandRepository {
  constructor(
    private readonly database: OfflineDatabase,
    private readonly idempotency: IdempotencyService,
    private readonly integrity: PayloadIntegrityService,
    @Inject(OFFLINE_NOW_PROVIDER) private readonly now: NowProvider,
  ) {}

  async persistConfirmedCommand<TPayload>(
    request: PersistConfirmedCommandRequest<TPayload>,
  ): Promise<PersistedCommand<JsonValue>> {
    const metadata = validateRequest(request);
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
      initialSyncStatus: request.initialSyncStatus ?? 'PENDING',
      ...(request.initialAuthBlockReason
        ? { initialAuthBlockReason: request.initialAuthBlockReason }
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
      ...(metadata.businessStatus ? { businessStatus: metadata.businessStatus } : {}),
      dependencyIds,
      occurredAt,
      createdAt: committedAt,
      updatedAt: committedAt,
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

    return defensiveCopy({
      localId: idempotencyKey,
      idempotencyKey,
      payloadHash: prepared.payloadHash,
      localRecord,
      outboxEntry,
      committedAt,
    });
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
  return (
    record.ownerId === fingerprint.ownerId &&
    record.aggregateType === fingerprint.aggregateType &&
    record.aggregateId === fingerprint.aggregateId &&
    record.commandType === fingerprint.commandType &&
    record.payloadSchemaVersion === fingerprint.payloadSchemaVersion &&
    record.canonicalPayload === fingerprint.canonicalPayload &&
    record.payloadHash === fingerprint.payloadHash &&
    record.businessStatus === fingerprint.businessStatus &&
    record.occurredAt === fingerprint.occurredAt &&
    sameStrings(record.dependencyIds, fingerprint.dependencyIds)
    && ('status' in record
      ? record.status === fingerprint.initialSyncStatus
        && record.authBlockReason === fingerprint.initialAuthBlockReason
      : true)
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
