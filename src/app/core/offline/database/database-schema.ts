export const DATABASE_NAME = 'plano-de-controle-operational';
export const DATABASE_VERSION = 5;

export const LOCAL_RECORDS_STORE = 'localRecords';
export const OUTBOX_STORE = 'outbox';
export const SYNC_RECEIPTS_STORE = 'syncReceipts';

export type OfflineStoreName =
  | typeof LOCAL_RECORDS_STORE
  | typeof OUTBOX_STORE
  | typeof SYNC_RECEIPTS_STORE;

export interface OfflineIndexSchema {
  readonly name: string;
  readonly keyPath: string | readonly string[];
  readonly unique: boolean;
}

export interface OfflineStoreSchema {
  readonly name: OfflineStoreName;
  readonly keyPath: string;
  readonly indexes: readonly OfflineIndexSchema[];
}

export interface OfflineDatabaseSchema {
  readonly name: string;
  readonly version: number;
  readonly stores: readonly OfflineStoreSchema[];
}

export const OFFLINE_DATABASE_SCHEMA: OfflineDatabaseSchema = {
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  stores: [
    {
      name: LOCAL_RECORDS_STORE,
      keyPath: 'localId',
      indexes: [
        // Diagnóstico de repetição e conflito local por identidade pública.
        { name: 'idempotencyKey', keyPath: 'idempotencyKey', unique: true },
        // Isolamento obrigatório das consultas do usuário autenticado.
        { name: 'ownerId', keyPath: 'ownerId', unique: false },
        // Histórico de um agregado dentro do escopo do proprietário.
        {
          name: 'ownerAggregate',
          keyPath: ['ownerId', 'aggregateType', 'aggregateId'],
          unique: false,
        },
        // Ordem estável de criação para recuperação operacional.
        { name: 'createdAt', keyPath: 'createdAt', unique: false },
      ],
    },
    {
      name: OUTBOX_STORE,
      keyPath: 'localId',
      indexes: [
        // Diagnóstico de repetição e conflito local por identidade pública.
        { name: 'idempotencyKey', keyPath: 'idempotencyKey', unique: true },
        // Isolamento obrigatório das consultas do usuário autenticado.
        { name: 'ownerId', keyPath: 'ownerId', unique: false },
        // Consumido pelo futuro processador da Story 16.2.
        { name: 'status', keyPath: 'status', unique: false },
        // Fila do proprietário por estado de sincronização.
        { name: 'ownerStatus', keyPath: ['ownerId', 'status'], unique: false },
        {
          name: 'ownerStatusDue',
          keyPath: ['ownerId', 'status', 'nextAttemptAt'],
          unique: false,
        },
        // Ordenação dos comandos de um mesmo agregado.
        {
          name: 'aggregateCreatedAt',
          keyPath: ['aggregateType', 'aggregateId', 'createdAt'],
          unique: false,
        },
        {
          name: 'ownerAggregateOrder',
          keyPath: ['ownerId', 'aggregateType', 'aggregateId', 'createdAt', 'localId'],
          unique: false,
        },
        {
          name: 'ownerOccurredAtLocalId',
          keyPath: ['ownerId', 'occurredAt', 'localId'],
          unique: false,
        },
        // Recuperação cronológica global da Outbox.
        { name: 'createdAt', keyPath: 'createdAt', unique: false },
      ],
    },
    {
      name: SYNC_RECEIPTS_STORE,
      keyPath: 'localId',
      indexes: [
        { name: 'ownerId', keyPath: 'ownerId', unique: false },
        {
          name: 'ownerArchivedAt',
          keyPath: ['ownerId', 'archivedAt'],
          unique: false,
        },
        {
          name: 'ownerExpiresAt',
          keyPath: ['ownerId', 'expiresAt'],
          unique: false,
        },
        {
          name: 'ownerAggregate',
          keyPath: ['ownerId', 'aggregateType', 'aggregateId'],
          unique: false,
        },
      ],
    },
  ],
};
