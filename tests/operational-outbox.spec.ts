import { expect, test } from '@playwright/test';

test('IndexedDB real captura CQ, operação, batelada e cadeia de parada na mesma Outbox', async ({
  page,
}) => {
  await page.goto('/_test/offline-persistence');
  await page.getByTestId('persist-operational-matrix').click();
  await expect(page.getByTestId('harness-result')).toContainText('"operationalMatrix":13');

  const matrix = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('plano-de-controle-operational');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const entries = await new Promise<any[]>((resolve, reject) => {
      const request = database.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return entries.map(entry => ({
      commandType: entry.commandType,
      dependencyIds: entry.dependencyIds,
    }));
  });

  expect(matrix.map(item => item.commandType)).toEqual(expect.arrayContaining([
    'GENERATE_INSPECTION_ROUTE',
    'SAVE_MEASUREMENT',
    'START_OPERATION',
    'REPORT_OPERATION',
    'START_BATCH',
    'REPORT_BATCH',
    'CREATE_STOP',
    'FINISH_STOP',
  ]));
  expect(matrix.find(item => item.commandType === 'FINISH_STOP')?.dependencyIds)
    .toEqual(['00000000-0000-4000-8000-000000000012']);
});
