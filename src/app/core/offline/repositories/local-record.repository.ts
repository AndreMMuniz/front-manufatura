import { Injectable } from '@angular/core';

import { OfflineDatabase } from '../database/offline-database';
import { LOCAL_RECORDS_STORE } from '../database/database-schema';
import { JsonValue, LocalRecord } from '../models/local-record';
import { assertOwnerId, defensiveCopy, requestResult } from './repository-utils';

@Injectable({ providedIn: 'root' })
export class LocalRecordRepository {
  constructor(private readonly database: OfflineDatabase) {}

  async getById(ownerId: string, localId: string): Promise<LocalRecord<JsonValue> | null> {
    const owner = assertOwnerId(ownerId);
    const transaction = await this.database.createTransaction([LOCAL_RECORDS_STORE], 'readonly');
    const record = await requestResult<LocalRecord<JsonValue> | undefined>(
      transaction.objectStore(LOCAL_RECORDS_STORE).get(localId),
      'Não foi possível consultar o registro local.',
    );
    return record?.ownerId === owner ? defensiveCopy(record) : null;
  }

  async getByIdempotencyKey(
    ownerId: string,
    idempotencyKey: string,
  ): Promise<LocalRecord<JsonValue> | null> {
    const owner = assertOwnerId(ownerId);
    const transaction = await this.database.createTransaction([LOCAL_RECORDS_STORE], 'readonly');
    const record = await requestResult<LocalRecord<JsonValue> | undefined>(
      transaction
        .objectStore(LOCAL_RECORDS_STORE)
        .index('idempotencyKey')
        .get(idempotencyKey),
      'Não foi possível consultar a identidade local.',
    );
    return record?.ownerId === owner ? defensiveCopy(record) : null;
  }

  async listByOwner(ownerId: string): Promise<readonly LocalRecord<JsonValue>[]> {
    const owner = assertOwnerId(ownerId);
    const transaction = await this.database.createTransaction([LOCAL_RECORDS_STORE], 'readonly');
    const records = await requestResult<LocalRecord<JsonValue>[]>(
      transaction.objectStore(LOCAL_RECORDS_STORE).index('ownerId').getAll(owner),
      'Não foi possível listar os registros locais.',
    );
    return defensiveCopy(records);
  }
}
