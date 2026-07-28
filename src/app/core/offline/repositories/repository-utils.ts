import { JsonValue } from '../models/local-record';
import { OfflineStorageError, toOfflineStorageError } from '../models/offline-storage-error';

export function requestResult<T>(request: IDBRequest<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toOfflineStorageError(request.error, message));
  });
}

export function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      // A falha de uma request deve chegar ao abort; somente `complete` confirma commit.
    };
    transaction.onabort = () =>
      reject(
        transaction.error ??
          new DOMException('A transação local foi cancelada antes do commit.', 'AbortError'),
      );
  });
}

export function defensiveCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

export function assertOwnerId(ownerId: string): string {
  const normalized = ownerId.trim();
  if (!normalized) {
    throw new OfflineStorageError(
      'PAYLOAD_INVALID',
      'ownerId é obrigatório para consultar a persistência operacional.',
    );
  }
  return normalized;
}

export function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
