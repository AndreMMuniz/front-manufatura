import type { Page } from '@playwright/test';

export interface OperationalOutboxEntry {
  readonly localId: string;
  readonly idempotencyKey: string;
  readonly commandType: string;
  readonly dependencyIds: readonly string[];
  readonly payload: Record<string, unknown>;
}

export async function readOperationalOutbox(page: Page): Promise<OperationalOutboxEntry[]> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('plano-de-controle-operational');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const entries = await new Promise<OperationalOutboxEntry[]>((resolve, reject) => {
      const request = database.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return entries;
  });
}
