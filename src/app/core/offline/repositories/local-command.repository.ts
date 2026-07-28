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
    const prepared = await this.integrity.prepare(request.payload);
    const committedAt = validDate(this.now(), 'O relógio local retornou uma data inválida.');
    const occurredAt = request.occurredAt
      ? validIsoDate(request.occurredAt)
      : committedAt;
    const dependencyIds = normalizeDependencyIds(request.dependencyIds);

    const existing = await this.findExisting(idempotencyKey);
    if (existing.localRecord || existing.outboxEntry) {
      return resolveExisting(existing, metadata.ownerId, prepared.payloadHash);
    }

    const localRecord: LocalRecord<JsonValue> = Object.freeze({
      localId: idempotencyKey,
      idempotencyKey,
      databaseVersion: DATABASE_VERSION,
      payloadSchemaVersion: request.payloadSchemaVersion,
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
      payloadSchemaVersion: request.payloadSchemaVersion,
      aggregateType: metadata.aggregateType,
      aggregateId: metadata.aggregateId,
      commandType: metadata.commandType,
      payload: prepared.snapshot,
      canonicalPayload: prepared.canonicalPayload,
      payloadHash: prepared.payloadHash,
      ownerId: metadata.ownerId,
      status: 'PENDING',
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
        return resolveExisting(diagnosed, metadata.ownerId, prepared.payloadHash);
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
  readonly businessStatus?: string;
} {
  const ownerId = requiredText(request.ownerId);
  const aggregateType = requiredText(request.aggregateType);
  const aggregateId = requiredText(request.aggregateId);
  const commandType = requiredText(request.commandType);
  if (!Number.isInteger(request.payloadSchemaVersion) || request.payloadSchemaVersion < 1) {
    throw new OfflineStorageError(
      'PAYLOAD_INVALID',
      'A versão do schema do payload deve ser um inteiro positivo.',
    );
  }
  const businessStatus = request.businessStatus?.trim();
  return { ownerId, aggregateType, aggregateId, commandType, ...(businessStatus ? { businessStatus } : {}) };
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
  ownerId: string,
  payloadHash: string,
): PersistedCommand<JsonValue> {
  if (
    !existing.localRecord ||
    !existing.outboxEntry ||
    existing.localRecord.ownerId !== ownerId ||
    existing.outboxEntry.ownerId !== ownerId ||
    existing.localRecord.payloadHash !== payloadHash ||
    existing.outboxEntry.payloadHash !== payloadHash
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
