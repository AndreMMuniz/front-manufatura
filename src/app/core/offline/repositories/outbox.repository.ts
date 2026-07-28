import { Injectable } from '@angular/core';

import { OfflineDatabase } from '../database/offline-database';
import { OUTBOX_STORE } from '../database/database-schema';
import { JsonValue } from '../models/local-record';
import { OutboxEntry } from '../models/outbox-entry';
import { assertOwnerId, defensiveCopy, requestResult } from './repository-utils';

@Injectable({ providedIn: 'root' })
export class OutboxRepository {
  constructor(private readonly database: OfflineDatabase) {}

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
}
